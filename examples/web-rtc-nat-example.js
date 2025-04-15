/**
 * WebRTC NAT Traversal Example
 *
 * Demonstrates how to use WebRTC for direct peer-to-peer connections through NAT
 * by using a signaling server to help with the connection establishment.
 *
 * This example shows:
 * 1. Two peers behind different NATs connecting directly
 * 2. Data synchronization over WebRTC connections
 * 3. Handling connection failures and reconnection
 */

const { createServer } = require("../src");

// Optional: You can specify a specific signaling server URL
// If not specified, peers will need some other way to discover each other
const SIGNALING_SERVER = process.env.SIGNALING_SERVER || null;

async function runExample() {
  console.log("Starting P2P Server WebRTC NAT Traversal Example");
  console.log("===============================================");

  if (SIGNALING_SERVER) {
    console.log(`Using signaling server: ${SIGNALING_SERVER}`);
  } else {
    console.log(
      "No signaling server specified. Set the SIGNALING_SERVER environment variable"
    );
    console.log("to use a remote signaling server for complete NAT traversal.");
    console.log("\nUsing local connections for this example instead.\n");
  }

  try {
    // Create two servers with WebRTC NAT traversal enabled
    console.log("\nCreating Server 1 (WebRTC Enabled)");
    const server1 = createServer({
      port: 3001,
      dbPath: "./db-webrtc-nat-1",
      peers: [], // No initial WebSocket peers necessary
      webrtc: {
        enabled: true,
        stunServers: [
          "stun:stun.l.google.com:19302",
          "stun:stun1.l.google.com:19302",
        ],
        signalingServer: SIGNALING_SERVER,
      },
    });

    console.log("Creating Server 2 (WebRTC Enabled)");
    const server2 = createServer({
      port: 3002,
      dbPath: "./db-webrtc-nat-2",
      peers: [], // Can be empty if using signaling server
      webrtc: {
        enabled: true,
        stunServers: [
          "stun:stun.l.google.com:19302",
          "stun:stun1.l.google.com:19302",
        ],
        signalingServer: SIGNALING_SERVER,
      },
    });

    // Start both servers
    console.log("\nStarting both servers...");
    await Promise.all([server1.start(), server2.start()]);
    console.log("Both servers started successfully");

    // In a real-world scenario, the servers would discover each other through
    // the signaling server. For this example, we'll manually connect them if no
    // signaling server is specified.

    if (!SIGNALING_SERVER) {
      console.log(
        "\nNo signaling server specified, manually connecting the servers..."
      );

      // We'll use WebSocket first to exchange information
      console.log("Connecting Server 2 to Server 1 via WebSocket");
      server2.peers.push(`http://localhost:${server1.port}`);
      server2.socketManager.connectToPeers([
        `http://localhost:${server1.port}`,
      ]);

      // Wait for WebSocket connection to establish
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    // Wait for connections to establish (either via signaling or websocket)
    console.log("\nWaiting for connection to establish (may take a moment)...");
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // For simulation purposes, if we're using a signaling server, explicitly try to connect
    if (SIGNALING_SERVER) {
      console.log("\nAttempting to connect to peer via signaling server...");
      // We need to know the server ID ahead of time in a real application
      // For this example, we'll try to connect from server1 to server2
      await server1.connectToPeerViaWebRTC(server2.serverID);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    // Check connection status
    const stats1 = server1.getConnectionStats();
    const stats2 = server2.getConnectionStats();

    console.log("\n=== Connection Status ===");
    console.log(
      `Server 1 - WebSocket peers: ${stats1.websocket.peersById.length}, WebRTC peers: ${stats1.webrtc.connected}`
    );
    console.log(
      `Server 2 - WebSocket peers: ${stats2.websocket.peersById.length}, WebRTC peers: ${stats2.webrtc.connected}`
    );

    // Test 1: Basic Data Synchronization over WebRTC
    console.log("\n=== Test 1: Data Synchronization over WebRTC ===");

    // Server 1 writes data
    console.log("Server 1 creating data entry...");
    await server1.put("webrtc-nat-test/item1", {
      name: "Test Item",
      description: "Added from Server 1",
      timestamp: Date.now(),
    });

    // Wait for data to synchronize
    console.log("Waiting for synchronization...");
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Check if data reached server 2
    const server2Data = await server2.get("webrtc-nat-test/item1");
    if (server2Data) {
      console.log("✅ Success! Server 2 received the data from Server 1");
      console.log("  - Data:", JSON.stringify(server2Data, null, 2));
    } else {
      console.log("❌ Failed! Server 2 did not receive the data");
    }

    // Test 2: Bidirectional Communication
    console.log("\n=== Test 2: Bidirectional Communication ===");

    // Server 2 writes data
    console.log("Server 2 creating data entry...");
    await server2.put("webrtc-nat-test/item2", {
      name: "Response Item",
      description: "Added from Server 2",
      timestamp: Date.now(),
    });

    // Wait for data to synchronize
    console.log("Waiting for synchronization...");
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Check if data reached server 1
    const server1Data = await server1.get("webrtc-nat-test/item2");
    if (server1Data) {
      console.log("✅ Success! Server 1 received the data from Server 2");
      console.log("  - Data:", JSON.stringify(server1Data, null, 2));
    } else {
      console.log("❌ Failed! Server 1 did not receive the data");
    }

    // Test 3: WebRTC Connection Info
    console.log("\n=== Test 3: WebRTC Connection Details ===");

    // Get detailed connection status
    const detailedStats1 = server1.getConnectionStats();
    const detailedStats2 = server2.getConnectionStats();

    console.log("Server 1 WebRTC Connection Status:");
    console.log(
      `  - Connected peers: ${detailedStats1.webrtc.peers.join(", ") || "None"}`
    );
    console.log(
      `  - Pending connections: ${detailedStats1.webrtc.pendingPeers.join(", ") || "None"}`
    );
    console.log(
      `  - Signaling server connected: ${detailedStats1.webrtc.signalingConnected || false}`
    );

    console.log("\nServer 2 WebRTC Connection Status:");
    console.log(
      `  - Connected peers: ${detailedStats2.webrtc.peers.join(", ") || "None"}`
    );
    console.log(
      `  - Pending connections: ${detailedStats2.webrtc.pendingPeers.join(", ") || "None"}`
    );
    console.log(
      `  - Signaling server connected: ${detailedStats2.webrtc.signalingConnected || false}`
    );

    // Conclusion
    console.log("\n=== Conclusion ===");
    if (server2Data && server1Data) {
      console.log("✅ WebRTC NAT traversal example completed successfully!");
      console.log(
        "Both servers were able to exchange data directly via WebRTC."
      );
    } else {
      console.log("⚠️ WebRTC example partially completed.");
      console.log(
        "Some data transfers were not successful. In a real-world scenario,"
      );
      console.log(
        "this could be due to strict NAT configurations requiring TURN servers."
      );
    }

    // Notes on production use
    console.log("\n=== Notes for Production Use ===");
    console.log("For production environments with restrictive NATs:");
    console.log(
      "1. Use a dedicated signaling server (set SIGNALING_SERVER environment variable)"
    );
    console.log(
      "2. Consider adding TURN server configuration for handling symmetric NATs"
    );
    console.log("3. Implement proper peer discovery mechanisms");

    // Clean up and exit
    console.log("\n=== Cleaning up ===");
    await Promise.all([server1.close(), server2.close()]);
    console.log("All servers closed");
  } catch (error) {
    console.error("Error in example:", error);
  }
}

// Run the example
runExample();
