# Agario Clone

Agario Clone is a multiplayer game where players control cells in a 2D world, consuming food and each other to grow larger. This project leverages the SpacetimeDB to manage real-time game state and player interactions.

## Features
- Real-time multiplayer gameplay
- Players can move around, eat food, and consume other players
- Dynamic spawning of food items
- Integrates 3D graphics using Three.js

## Installation and Setup

### Prerequisites
- Node.js (version 12 or higher)
- Rust (latest stable version)
- A suitable package manager (npm or yarn)
- SpacetimeDB

### Clone the Repository
```bash
git clone https://github.com/aidanvidal/SpacetimeDB-Agario-Demo.git
cd agario-clone
```

### Server Setup
1. Start SpacetimeDB:
   ```bash
   spacetime start
   ```

2. Build/Publish the Rust server:
   ```bash
   spacetime publish --project-path server agario
   ```

### Client Setup
1. Navigate to the client directory:
   ```bash
   cd client
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the client application:
   ```bash
   npm run dev
   ```

## Usage

1. After the server is running, open your browser and navigate to `http://localhost:3000` to play the game.

2. Use the WASD keys to move your player around the game world.

3. The objective is to consume food items and other players to grow in size and improve your score.

## Dependencies

- [SpacetimeDB](https://spacetimedb.com/) for real-time database management
- [Three.js](https://threejs.org/) for 3D graphics rendering
- [rand](https://crates.io/crates/rand) for random number generation

### Project Structure

- `server/src/lib.rs`: Contains the server-side game logic using Rust with SpacetimeDB.
- `client/src/App.tsx`: Main application component that connects to the server and handles player interaction and state.
- `client/src/Game.tsx`: Renders the game scene using Three.js and manages player and food objects.
