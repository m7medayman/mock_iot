require('dotenv').config();
const mqtt = require('mqtt');
const admin = require('firebase-admin');

// Initialize Firebase
const serviceAccount = require('./firebase-credentials.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL
});

const db = admin.firestore();
const rtdb = admin.database();

// Configuration for data retention
const CONFIG = {
    FIRESTORE_RETENTION_DAYS: 30, // Keep 30 days of history in Firestore
    CLEANUP_INTERVAL_HOURS: 24, // Run cleanup every 24 hours
    MAX_FIRESTORE_RECORDS_PER_DEVICE: 1000 // Safety limit for Firestore
};

// MQTT Configuration
const options = {
    host: process.env.MQTT_BROKER,
    port: parseInt(process.env.MQTT_PORT),
    username: process.env.MQTT_USERNAME,
    password: process.env.MQTT_PASSWORD,
    protocol: process.env.MQTT_PORT == 8883 ? 'mqtts' : 'mqtt',
    clean: true,
    clientId: `firebase_bridge_${Math.random().toString(16).slice(3)}`
};

console.log('🔌 Connecting MQTT Bridge to Broker...');
console.log(`   Broker: ${options.host}:${options.port}`);
console.log(`   Topic: ${process.env.MQTT_TOPIC}\n`);

const client = mqtt.connect(options);

// Cleanup function for Firestore ONLY
async function cleanupFirestore() {
    console.log('🧹 Starting Firestore cleanup...');
    
    try {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - CONFIG.FIRESTORE_RETENTION_DAYS);
        
        const devicesSnapshot = await db.collection('refrigerators').get();
        let totalDeleted = 0;
        
        for (const deviceDoc of devicesSnapshot.docs) {
            const deviceId = deviceDoc.id;
            
            // Delete old history records
            const oldRecords = await db.collection('refrigerators')
                .doc(deviceId)
                .collection('history')
                .where('savedAt', '<', cutoffDate)
                .limit(500) // Batch delete to avoid timeout
                .get();
            
            if (!oldRecords.empty) {
                const batch = db.batch();
                oldRecords.docs.forEach(doc => {
                    batch.delete(doc.ref);
                });
                await batch.commit();
                totalDeleted += oldRecords.size;
                console.log(`   Deleted ${oldRecords.size} old records from device: ${deviceId}`);
            }
            
            // Safety check: limit total records per device
            const allRecords = await db.collection('refrigerators')
                .doc(deviceId)
                .collection('history')
                .orderBy('savedAt', 'desc')
                .get();
            
            if (allRecords.size > CONFIG.MAX_FIRESTORE_RECORDS_PER_DEVICE) {
                const excessRecords = allRecords.docs.slice(CONFIG.MAX_FIRESTORE_RECORDS_PER_DEVICE);
                const batch = db.batch();
                excessRecords.forEach(doc => {
                    batch.delete(doc.ref);
                });
                await batch.commit();
                totalDeleted += excessRecords.length;
                console.log(`   Deleted ${excessRecords.length} excess records from device: ${deviceId}`);
            }
        }
        
        console.log(`✅ Firestore cleanup completed. Total deleted: ${totalDeleted} records\n`);
    } catch (error) {
        console.error('❌ Firestore cleanup error:', error);
    }
}

// Combined cleanup function
async function performCleanup() {
    console.log('\n🔄 Starting scheduled cleanup...\n');
    await cleanupFirestore();
    console.log('✅ Cleanup completed\n');
}

// Schedule cleanup
setInterval(() => {
    performCleanup();
}, CONFIG.CLEANUP_INTERVAL_HOURS * 60 * 60 * 1000);

// Run initial cleanup after 1 minute
setTimeout(() => {
    performCleanup();
}, 60000);

client.on('connect', () => {
    console.log('✅ MQTT Bridge Connected');
    // Initialize Firebase
const serviceAccount = require('./firebase-credentials.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL
});

const db = admin.firestore();
const rtdb = admin.database();

    // Subscribe to refrigerator topic
    client.subscribe(process.env.MQTT_TOPIC, { qos: 1 }, (err) => {
        if (err) {
            console.error('❌ Subscription Error:', err);
        } else {
            console.log(`✅ Subscribed to: ${process.env.MQTT_TOPIC}`);
            console.log('🔥 Firebase Connected');
            console.log('   📡 RTDB: Latest data only (real-time broadcasting)');
            console.log(`   💾 Firestore: Latest + ${CONFIG.FIRESTORE_RETENTION_DAYS} days history`);
            console.log(`   🧹 Cleanup runs every ${CONFIG.CLEANUP_INTERVAL_HOURS} hours\n`);
            console.log('👂 Listening for messages...\n');
        }
    });
});

client.on('message', async (topic, message) => {
    try {
        const data = JSON.parse(message.toString());
        console.log('📥 Received:', {
            deviceId: data.deviceId,
            temperature: data.temperature,
            doorStatus: data.doorStatus,
            timestamp: data.timestamp
        });
        
        // 1. Save to Realtime Database (LATEST DATA ONLY - for real-time broadcasting)
        await rtdb.ref(`refrigerators/${data.deviceId}`).set({
            temperature: data.temperature,
            doorStatus: data.doorStatus,
            timestamp: data.timestamp,
            lastUpdated: admin.database.ServerValue.TIMESTAMP
        });
        
        console.log('✅ Updated RTDB (latest data only)');
        
        // 2. Save to Firestore (LATEST + HISTORY - for persistent storage)
        const firestorePromises = [
            // Update latest data
            db.collection('refrigerators')
                .doc(data.deviceId)
                .set({
                    temperature: data.temperature,
                    doorStatus: data.doorStatus,
                    timestamp: data.timestamp,
                    name: data.name,
                    lastUpdated: admin.firestore.FieldValue.serverTimestamp()
                }, { merge: true }),
            
            // Add to history collection
            db.collection('refrigerators')
                .doc(data.deviceId)
                .collection('history')
                .add({
                    temperature: data.temperature,
                    doorStatus: data.doorStatus,
                    timestamp: data.timestamp,
                    name: data.name,
                    savedAt: admin.firestore.FieldValue.serverTimestamp()
                })
        ];
        
        await Promise.all(firestorePromises);
        console.log('✅ Saved to Firestore (latest + history)\n');
        
    } catch (error) {
        console.error('❌ Error processing message:', error);
    }
});

client.on('error', (err) => {
    console.error('❌ MQTT Error:', err);
});

// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n⛔ Stopping MQTT Bridge...');
    
    // Perform final cleanup before shutdown
    console.log('🧹 Running final cleanup...');
    await performCleanup();
    
    client.end(false, () => {
        console.log('✅ Disconnected from MQTT Broker');
        process.exit(0);
    });
});

// Log storage stats periodically (optional)
async function logStorageStats() {
    try {
        // Count devices in RTDB
        const rtdbSnapshot = await rtdb.ref('refrigerators').once('value');
        const rtdbDevices = rtdbSnapshot.val();
        const rtdbDeviceCount = rtdbDevices ? Object.keys(rtdbDevices).length : 0;
        
        // Count Firestore documents
        const devicesSnapshot = await db.collection('refrigerators').get();
        let totalFirestoreRecords = 0;
        
        for (const deviceDoc of devicesSnapshot.docs) {
            const historySnapshot = await db.collection('refrigerators')
                .doc(deviceDoc.id)
                .collection('history')
                .count()
                .get();
            totalFirestoreRecords += historySnapshot.data().count;
        }
        
        console.log('📊 Storage Stats:');
        console.log(`   // Initialize Firebase
const serviceAccount = require('./firebase-credentials.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL
});

const db = admin.firestore();
const rtdb = admin.database();
RTDB: ${rtdbDeviceCount} devices (latest data only)`);
        console.log(`   Firestore: ${devicesSnapshot.size} devices, ~${totalFirestoreRecords} history records`);
        console.log(`   Spark Plan Limits: 20k writes/day, 50k reads/day, 1GB storage\n`);
    } catch (error) {
        console.error('❌ Error getting stats:', error);
    }
}

// Log stats every 6 hours
setInterval(logStorageStats, 6 * 60 * 60 * 1000);