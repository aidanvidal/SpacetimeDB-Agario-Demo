import { useEffect, useState } from "react";
import {
  DbConnection,
  type ErrorContext,
  type EventContext,
  Player,
  Food
} from "./module_bindings";
import { Identity } from "@clockworklabs/spacetimedb-sdk";
import { Game } from "./Game";
import "./App.css";

function usePlayer(conn: DbConnection | null): Map<string, Player> {
  const [players, setPlayers] = useState<Map<string, Player>>(new Map());

  useEffect(() => {
    if (!conn) return;

    const onInsert = (_ctx: EventContext, player: Player) => {
      setPlayers((prev) =>
        new Map(prev).set(player.identity.toHexString(), player)
      );
    };
    conn.db.player.onInsert(onInsert);

    const onUpdate = (_ctx: EventContext, oldPlayer: Player, player: Player) => {
      setPlayers((prev) => {
        prev.delete(oldPlayer.identity.toHexString());
        return new Map(prev).set(player.identity.toHexString(), player);
      });
    };
    conn.db.player.onUpdate(onUpdate);

    const onDelete = (_ctx: EventContext, player: Player) => {
      setPlayers((prev) => {
        prev.delete(player.identity.toHexString());
        return new Map(prev);
      });
    };
    conn.db.player.onDelete(onDelete);
    return () => {
      conn.db.player.removeOnInsert(onInsert);
      conn.db.player.removeOnUpdate(onUpdate);
      conn.db.player.removeOnDelete(onDelete);
    };
  }, [conn]);

  return players;
}

function useFood(conn: DbConnection | null): Food[] {
  const [food, setFood] = useState<Food[]>([]);

  useEffect(() => {
    if (!conn) return;

    const onInsert = (_ctx: EventContext, foodItem: Food) => {
      setFood((prev) => [...prev, foodItem]);
    };
    conn.db.food.onInsert(onInsert);

    const onUpdate = (_ctx: EventContext, oldFood: Food, foodItem: Food) => {
      setFood((prev) => {
        const index = prev.findIndex((f) => f.id === oldFood.id);
        if (index !== -1) {
          const updated = [...prev];
          updated[index] = foodItem;
          return updated;
        }
        return prev;
      });
    };
    conn.db.food.onUpdate(onUpdate);

    const onDelete = (_ctx: EventContext, foodItem: Food) => {
      setFood((prev) => prev.filter((f) => f.id !== foodItem.id));
    };
    conn.db.food.onDelete(onDelete);

    return () => {
      conn.db.food.removeOnInsert(onInsert);
      conn.db.food.removeOnUpdate(onUpdate);
      conn.db.food.removeOnDelete(onDelete);
    };
  }, [conn]);

  return food;
}

function App() {
  const [connected, setConnected] = useState<boolean>(false);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [conn, setConn] = useState<DbConnection | null>(null);

  useEffect(() => {
    const subscribeToQueries = (conn: DbConnection, queries: string[]) => {
      conn
        ?.subscriptionBuilder()
        .onApplied(() => {
          console.log("SDK client cache initialized.");
        })
        .subscribe(queries);
    };

    const onConnect = (
      conn: DbConnection,
      identity: Identity,
      token: string
    ) => {
      setIdentity(identity);
      setConnected(true);
      localStorage.setItem("auth_token", token);
      console.log(
        "Connected to SpacetimeDB with identity:",
        identity.toHexString()
      );
      // Register callbacks for player and food tables
      subscribeToQueries(conn, ["SELECT * FROM player", "SELECT * FROM food"]);
    };

    const onDisconnect = () => {
      console.log("Disconnected from SpacetimeDB");
      setConnected(false);
    };

    const onConnectError = (_ctx: ErrorContext, err: Error) => {
      console.log("Error connecting to SpacetimeDB:", err);
    };

    setConn(
      DbConnection.builder()
        .withUri("ws://localhost:3000")
        .withModuleName("agario")
        .withToken(localStorage.getItem("auth_token") || "")
        .onConnect(onConnect)
        .onDisconnect(onDisconnect)
        .onConnectError(onConnectError)
        .build()
    );
  }, []);

  const players = usePlayer(conn);
  const food = useFood(conn);
  return (
    <>
      {!conn || !connected || !identity ? (
        <div className="connecting">
          <h2>Connecting to Agario...</h2>
        </div>
      ) : (
        <div className="game-container">
          <h2>Connected as: {identity?.toHexString()}</h2>
          <Game conn={conn} identity={identity} players={players} food={food} />

          <div>
            <h3>Online Players ({[...players.values()].filter(p => p.online).length})</h3>
            <ul className="player-list">
              {[...players.values()]
                .filter((player) => player.online)
                .map((player) => (
                  <li 
                    key={player.identity.toHexString()}
                    className={`player-item ${player.identity.toHexString() === identity.toHexString() ? 'current-player' : ''}`}
                  >
                    {player.identity.toHexString() === identity.toHexString() ? '(You) ' : ''}
                    {player.identity.toHexString().substring(0, 16)}...
                  </li>
                ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}

export default App;
