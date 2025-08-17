use spacetimedb::{table, reducer, Identity, ReducerContext, SpacetimeType, Table, ScheduleAt, TimeDuration};
use rand::Rng;


#[derive(SpacetimeType, Clone, Copy, Debug, PartialEq)]
pub struct Color {
    pub r: u8,
    pub g: u8,
    pub b: u8,
}

#[derive(SpacetimeType, Clone, Copy, Debug, PartialEq)]
pub struct Position {
    pub x: f32,
    pub y: f32,
}

#[table(name = player, public)]
pub struct Player {
    #[primary_key]
    identity: Identity,
    online: bool,
    color: Color,
    position: Position,
    score: u32,
    radius: f32,
}

#[table(name = food, public)]
pub struct Food {
    #[primary_key]
    #[auto_inc]
    id: u64,
    position: Position,
    color: Color,
}

#[table(name = food_spawn_schedule, scheduled(spawn_food))]
pub struct FoodSpawnSchedule {
    #[primary_key]
    #[auto_inc]
    scheduled_id: u64,
    scheduled_at: ScheduleAt,
}

const PLAYER_START_SIZE: f32 = 20.0;

#[reducer(client_connected)]
// Called when a client connects to the server
pub fn client_connected(ctx: &ReducerContext) {
    if let Some(player) = ctx.db.player().identity().find(ctx.sender) {
        // Player already exists, set the online status
        ctx.db.player().identity().update(Player { online: true, ..player });
        
        log::info!("Player reconnected: {:?}", ctx.sender);
    }
    else {
        // Player does not exist, create a new player
        let spawn_position = Position { x: 250.0, y: 250.0 }; // Start in center of 500x500 world
        
        ctx.db.player().insert(Player {
            identity: ctx.sender,
            online: true,
            color: Color {
                r: ctx.rng().gen(),
                g: ctx.rng().gen(),
                b: ctx.rng().gen(),
            },
            position: spawn_position,
            score: 0,
            radius: PLAYER_START_SIZE,
        });
        
        log::info!("New player created: {:?}", ctx.sender);
    }
}

#[reducer(client_disconnected)]
// Called when a client disconnects from the server
pub fn client_disconnected(ctx: &ReducerContext) {
    if let Some(player) = ctx.db.player().identity().find(ctx.sender) {
        // Player exists, set the online status to false
        ctx.db.player().identity().update(Player { online: false, ..player });
    }
    else {
        // Player does not exist
        log::warn!("Player disconnected but does not exist: {:?}", ctx.sender);
    }
}

#[reducer]
// Called when a player moves
pub fn player_moved(ctx: &ReducerContext, position: Position) {
    if let Some(player) = ctx.db.player().identity().find(ctx.sender) {
        // Update the player's position
        ctx.db.player().identity().update(Player { position, ..player });
        
        // Check for food collisions after moving
        check_food_collisions(ctx, position, player.score);
        
        // Check for player collisions
        check_player_collisions(ctx, position);
    }
    else {
        // Player does not exist
        log::warn!("Player moved but does not exist: {:?}", ctx.sender);
    }
}

// Food spawner configuration
const MAX_FOOD_COUNT: u64 = 100;
const WORLD_SIZE: f32 = 500.0;
const FOOD_SPAWN_INTERVAL_SECONDS: u64 = 2; // 2 seconds
const FOOD_RADIUS: f32 = 5.0;

// Helper function to calculate distance between two positions
fn distance(pos1: Position, pos2: Position) -> f32 {
    let dx = pos1.x - pos2.x;
    let dy = pos1.y - pos2.y;
    (dx * dx + dy * dy).sqrt()
}

// Helper function to check for food collisions and handle eating
fn check_food_collisions(ctx: &ReducerContext, player_position: Position, current_score: u32) {
    let Some(player) = ctx.db.player().identity().find(ctx.sender) else {
        log::warn!("Player does not exist for collision check: {:?}", ctx.sender);
        return;
    };
    let collision_distance = player.radius + FOOD_RADIUS;
    let mut foods_to_eat = Vec::new();
    
    // Find all food items that collide with the player
    for food in ctx.db.food().iter() {
        if distance(player_position, food.position) <= collision_distance {
            foods_to_eat.push(food.id);
        }
    }
    
    // Eat all colliding food items
    if !foods_to_eat.is_empty() {
        let foods_eaten = foods_to_eat.len() as u32;
        
        // Remove all eaten food items
        for food_id in foods_to_eat {
            ctx.db.food().id().delete(food_id);
        }
        
        // Update player's score & radius
        if let Some(player) = ctx.db.player().identity().find(ctx.sender) {
            ctx.db.player().identity().update(Player { 
                score: current_score + foods_eaten, 
                radius: player.radius + foods_eaten as f32,
                ..player 
            });
        }
        
        log::info!("Player {:?} ate {} food items. New score: {}", 
                  ctx.sender, foods_eaten, current_score + foods_eaten);
    }
}

// Helper function to check for collisions between players
fn check_player_collisions(ctx: &ReducerContext, player_position: Position) {
    let Some(player) = ctx.db.player().identity().find(ctx.sender) else {
        log::warn!("Player does not exist for collision check: {:?}", ctx.sender);
        return;
    };
    
    // Check collisions with other players
    for other_player in ctx.db.player().iter() {
        if other_player.identity == ctx.sender || !other_player.online {
            continue; // Skip self and offline players
        }

        let collision_distance = player.radius.max(other_player.radius);
        if distance(player_position, other_player.position) <= collision_distance {
            let radius_diff = player.radius - other_player.radius;
            if radius_diff.abs() > 5.0 {
            let (eater, eaten) = if radius_diff > 0.0 {
                (ctx.sender, other_player.identity)
            } else {
                (other_player.identity, ctx.sender)
            };
            // Respawn the eaten player with starting stats
            ctx.db.player().identity().update(Player {
                identity: eaten,
                online: true,
                color: Color {
                    r: ctx.rng().gen(),
                    g: ctx.rng().gen(),
                    b: ctx.rng().gen(),
                },
                position: Position { x: 250.0, y: 250.0 },
                score: 0,
                radius: PLAYER_START_SIZE,
            });
            log::info!("Player {:?} ate player {:?}", eater, eaten);
            }
        }
    }
}

#[reducer(init)]
// Called when the module is first deployed or updated
pub fn init(ctx: &ReducerContext) {    
    // Create the scheduled food spawner that runs every 2 seconds
    let spawn_interval = TimeDuration::from_micros((FOOD_SPAWN_INTERVAL_SECONDS * 1_000_000) as i64);
    ctx.db.food_spawn_schedule().insert(FoodSpawnSchedule {
        scheduled_id: 0, // Auto-incremented
        scheduled_at: spawn_interval.into(), // This creates a looping schedule
    });
    
    log::info!("Food spawner started and will run every {} seconds", FOOD_SPAWN_INTERVAL_SECONDS);
}

#[reducer]
// Periodically spawn food items - called by the scheduler
pub fn spawn_food(ctx: &ReducerContext, _arg: FoodSpawnSchedule) {

    // Ensure only the scheduler can call this reducer
    if ctx.sender != ctx.identity() {
        log::warn!("Reducer `spawn_food` may not be invoked by clients, only via scheduling");
        return;
    }
    
    let current_food_count = ctx.db.food().count();
    
    if current_food_count < MAX_FOOD_COUNT {
        // Calculate how many food items to spawn (spawn 1-3 at a time)
        let spawn_count = ctx.rng().gen_range(1..=3).min(MAX_FOOD_COUNT - current_food_count);
        
        for _ in 0..spawn_count {
            // Generate random position within the world bounds
            let x = ctx.rng().gen_range(-WORLD_SIZE..WORLD_SIZE);
            let y = ctx.rng().gen_range(-WORLD_SIZE..WORLD_SIZE);
            
            // Generate random color for the food
            let color = Color {
                r: ctx.rng().gen(),
                g: ctx.rng().gen(),
                b: ctx.rng().gen(),
            };
            
            // Insert the new food item
            ctx.db.food().insert(Food {
                id: 0, // Auto-incremented
                position: Position { x, y },
                color,
            });
        }
        
        log::info!("Spawned {} food items. Total food count: {}", spawn_count, current_food_count + spawn_count);
    }
    
    // The scheduling system automatically handles the next call
}