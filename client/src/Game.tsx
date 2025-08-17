import { useEffect, useRef } from "react";
import * as THREE from "three";
import { DbConnection, Player, Position, Food } from "./module_bindings";
import { Identity } from "@clockworklabs/spacetimedb-sdk";

interface GameProps {
  conn: DbConnection;
  identity: Identity;
  players: Map<string, Player>;
  food: Food[];
}

const WORLD_SIZE = 1000;
const CAMERA_SIZE = 400;
const FOOD_RADIUS = 5;
const MOVE_SPEED = 200; // pixels per second

export function Game({ conn, identity, players, food }: GameProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.OrthographicCamera | null>(null);
  const playerMeshesRef = useRef<Map<string, THREE.Mesh>>(new Map());
  const foodMeshesRef = useRef<Map<bigint, THREE.Mesh>>(new Map());
  const keysRef = useRef<Set<string>>(new Set());
  const lastUpdateRef = useRef<number>(Date.now());
  const myPlayerRef = useRef<Player | null>(null);

  // Initialize Three.js scene
  useEffect(() => {
    if (!mountRef.current) return;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a1a);
    sceneRef.current = scene;

    // Camera (orthographic for 2D)
    const camera = new THREE.OrthographicCamera(
      -CAMERA_SIZE,
      CAMERA_SIZE,
      CAMERA_SIZE,
      -CAMERA_SIZE,
      0.1,
      1000
    );
    camera.position.z = 10;
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      premultipliedAlpha: false,
    });
    renderer.setSize(800, 600);
    renderer.setClearColor(0x1a1a1a, 1);

    // Clear any existing canvas elements to prevent duplicates
    while (mountRef.current.firstChild) {
      mountRef.current.removeChild(mountRef.current.firstChild);
    }

    mountRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Create a SINGLE fixed grid that doesn't move with camera
    const gridGeometry = new THREE.BufferGeometry();
    const gridMaterial = new THREE.LineBasicMaterial({
      color: 0x333333,
      transparent: false,
    });

    const gridSize = WORLD_SIZE;
    const gridStep = 50;
    const points = [];

    // Vertical lines
    for (let i = -gridSize / 2; i <= gridSize / 2; i += gridStep) {
      points.push(i, -gridSize / 2, -1); // Put grid slightly behind players
      points.push(i, gridSize / 2, -1);
    }

    // Horizontal lines
    for (let i = -gridSize / 2; i <= gridSize / 2; i += gridStep) {
      points.push(-gridSize / 2, i, -1);
      points.push(gridSize / 2, i, -1);
    }

    gridGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(points, 3)
    );
    const grid = new THREE.LineSegments(gridGeometry, gridMaterial);
    grid.name = "backgroundGrid"; // Name it so we can identify it
    scene.add(grid);

    return () => {
      if (mountRef.current && renderer.domElement) {
        mountRef.current.removeChild(renderer.domElement);
      }
      // Clean up all geometry and materials
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          if (object.material instanceof THREE.Material) {
            object.material.dispose();
          }
        }
      });
      renderer.dispose();
    };
  }, []);

  // Update player meshes when players change
  useEffect(() => {
    if (!sceneRef.current) return;

    const scene = sceneRef.current;
    const playerMeshes = playerMeshesRef.current;

    // Remove old meshes for players that no longer exist
    for (const [playerId, mesh] of playerMeshes.entries()) {
      if (!players.has(playerId)) {
        scene.remove(mesh);
        playerMeshes.delete(playerId);
      }
    }

    // Add or update meshes for current players
    const sortedPlayers = Array.from(players.entries())
      .filter(([_, player]) => player.online)
      .sort(([, a], [, b]) => a.radius - b.radius);

    for (const [playerId, player] of sortedPlayers) {
      if (!player.online) continue;

      let mesh = playerMeshes.get(playerId);
      let needsRadiusUpdate = false;
      let needsColorUpdate = false;

      if (!mesh) {
        // Create new mesh for this player
        const geometry = new THREE.CircleGeometry(player.radius, 32);
        const material = new THREE.MeshBasicMaterial({
          color: new THREE.Color(
            player.color.r / 255,
            player.color.g / 255,
            player.color.b / 255
          ),
        });
        mesh = new THREE.Mesh(geometry, material);

        // Store the current radius and color for comparison
        (mesh as any).currentRadius = player.radius;
        (mesh as any).currentColor = { ...player.color };

        // Add outline for the current player
        if (playerId === identity.toHexString()) {
          const outlineGeometry = new THREE.RingGeometry(
            player.radius,
            player.radius + 2,
            32
          );
          const outlineMaterial = new THREE.MeshBasicMaterial({
            color: 0xffffff,
          });
          const outline = new THREE.Mesh(outlineGeometry, outlineMaterial);
          outline.name = "outline";
          mesh.add(outline);
          myPlayerRef.current = player;
        }

        scene.add(mesh);
        playerMeshes.set(playerId, mesh);
      } else {
        // Check if radius has changed
        if ((mesh as any).currentRadius !== player.radius) {
          needsRadiusUpdate = true;
          (mesh as any).currentRadius = player.radius;
        }
        // Check if color has changed
        const prevColor = (mesh as any).currentColor;
        if (
          !prevColor ||
          prevColor.r !== player.color.r ||
          prevColor.g !== player.color.g ||
          prevColor.b !== player.color.b
        ) {
          needsColorUpdate = true;
          (mesh as any).currentColor = { ...player.color };
        }
      }

      // Update geometry if radius changed
      if (needsRadiusUpdate) {
        // Dispose old geometry
        mesh.geometry.dispose();

        // Create new geometry with updated radius
        mesh.geometry = new THREE.CircleGeometry(player.radius, 32);

        // Update outline if this is the current player
        if (playerId === identity.toHexString()) {
          const outline = mesh.children.find(
            (child) => child.name === "outline"
          ) as THREE.Mesh;
          if (outline) {
            outline.geometry.dispose();
            outline.geometry = new THREE.RingGeometry(
              player.radius,
              player.radius + 2,
              32
            );
          }
        }
      }

      // Update material color if color changed
      if (needsColorUpdate) {
        if (mesh.material instanceof THREE.MeshBasicMaterial) {
          mesh.material.color.setRGB(
            player.color.r / 255,
            player.color.g / 255,
            player.color.b / 255
          );
        }
      }

      // Update mesh position
      mesh.position.set(player.position.x, player.position.y, 0);
    }
  }, [players, identity]);

  // Update food meshes when food changes
  useEffect(() => {
    if (!sceneRef.current || !food) return;

    const scene = sceneRef.current;
    const foodMeshes = foodMeshesRef.current;

    // Remove old meshes for food that no longer exists
    const currentFoodIds = new Set(food.map((f) => f.id));
    for (const [foodId, mesh] of foodMeshes.entries()) {
      if (!currentFoodIds.has(foodId)) {
        scene.remove(mesh);
        mesh.geometry.dispose();
        if (mesh.material instanceof THREE.Material) {
          mesh.material.dispose();
        }
        foodMeshes.delete(foodId);
      }
    }

    // Add or update meshes for current food
    for (const foodItem of food) {
      let mesh = foodMeshes.get(foodItem.id);

      if (!mesh) {
        // Create new mesh for this food item
        const geometry = new THREE.CircleGeometry(FOOD_RADIUS, 16);
        const material = new THREE.MeshBasicMaterial({
          color: new THREE.Color(
            foodItem.color.r / 255,
            foodItem.color.g / 255,
            foodItem.color.b / 255
          ),
        });
        mesh = new THREE.Mesh(geometry, material);
        mesh.position.z = -0.5; // Place food slightly behind players

        scene.add(mesh);
        foodMeshes.set(foodItem.id, mesh);
      }

      // Update mesh position
      mesh.position.set(foodItem.position.x, foodItem.position.y, -0.5);
    }
  }, [food]);

  // Handle keyboard input
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (["w", "a", "s", "d"].includes(key)) {
        keysRef.current.add(key);
        event.preventDefault();
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      keysRef.current.delete(key);
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  // Game loop for movement and rendering
  useEffect(() => {
    let animationId: number;

    const gameLoop = () => {
      const now = Date.now();
      const deltaTime = (now - lastUpdateRef.current) / 1000; // Convert to seconds
      lastUpdateRef.current = now;

      // Update player position based on input
      if (myPlayerRef.current && keysRef.current.size > 0) {
        let deltaX = 0;
        let deltaY = 0;

        if (keysRef.current.has("w")) deltaY += MOVE_SPEED * deltaTime;
        if (keysRef.current.has("s")) deltaY -= MOVE_SPEED * deltaTime;
        if (keysRef.current.has("a")) deltaX -= MOVE_SPEED * deltaTime;
        if (keysRef.current.has("d")) deltaX += MOVE_SPEED * deltaTime;

        if (deltaX !== 0 || deltaY !== 0) {
          const currentPlayer = players.get(identity.toHexString());
          if (currentPlayer) {
            const newPosition: Position = {
              x: Math.max(
                -WORLD_SIZE / 2,
                Math.min(WORLD_SIZE / 2, currentPlayer.position.x + deltaX)
              ),
              y: Math.max(
                -WORLD_SIZE / 2,
                Math.min(WORLD_SIZE / 2, currentPlayer.position.y + deltaY)
              ),
            };

            // Send position update to server
            conn.reducers.playerMoved(newPosition);
          }
        }
      }

      // Update camera to follow current player with bounds
      if (cameraRef.current && myPlayerRef.current) {
        const currentPlayer = players.get(identity.toHexString());
        if (currentPlayer) {
          // Calculate camera bounds based on world size and camera view size
          const cameraHalfWidth = CAMERA_SIZE;
          const cameraHalfHeight = CAMERA_SIZE;
          const worldHalfSize = WORLD_SIZE / 2;

          // Calculate the bounds for camera position
          const minCameraX = -worldHalfSize + cameraHalfWidth;
          const maxCameraX = worldHalfSize - cameraHalfWidth;
          const minCameraY = -worldHalfSize + cameraHalfHeight;
          const maxCameraY = worldHalfSize - cameraHalfHeight;

          // Clamp camera position to stay within bounds
          const targetX = Math.max(
            minCameraX,
            Math.min(maxCameraX, currentPlayer.position.x)
          );
          const targetY = Math.max(
            minCameraY,
            Math.min(maxCameraY, currentPlayer.position.y)
          );

          cameraRef.current.position.x = targetX;
          cameraRef.current.position.y = targetY;
          myPlayerRef.current = currentPlayer;
        }
      }

      // Render the scene
      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }

      animationId = requestAnimationFrame(gameLoop);
    };

    gameLoop();

    return () => {
      if (animationId) {
        cancelAnimationFrame(animationId);
      }
    };
  }, [conn, identity, players]);

  // Get current player for score display
  const currentPlayer = players.get(identity.toHexString());

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "20px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "20px",
          marginBottom: "10px",
        }}
      >
        <div
          style={{
            color: "#fff",
            fontSize: "18px",
            fontWeight: "bold",
            padding: "8px 16px",
            backgroundColor: "#333",
            borderRadius: "8px",
            border: "2px solid #555",
          }}
        >
          Score: {currentPlayer?.score ?? 0}
        </div>
        <div
          style={{
            color: "#888",
            fontSize: "14px",
            padding: "8px 16px",
            backgroundColor: "#222",
            borderRadius: "8px",
            border: "1px solid #444",
          }}
        >
          Food: {food.length}
        </div>
      </div>
      <div
        ref={mountRef}
        style={{
          border: "2px solid #444",
          borderRadius: "8px",
          overflow: "hidden",
          position: "relative",
        }}
      >
        {/* Score overlay on the game canvas */}
        <div
          style={{
            position: "absolute",
            top: "10px",
            left: "10px",
            color: "#fff",
            fontSize: "20px",
            fontWeight: "bold",
            textShadow: "2px 2px 4px rgba(0,0,0,0.8)",
            zIndex: 1000,
            pointerEvents: "none",
          }}
        >
          Score: {currentPlayer?.score ?? 0}
        </div>
      </div>
      <div style={{ textAlign: "center", color: "#888", fontSize: "14px" }}>
        Use WASD keys to move your player
      </div>
    </div>
  );
}
