const admin = require('firebase-admin');
require('dotenv').config();

const serviceAccount = require('./firebase-credentials.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL
});

const db = admin.firestore();
const rtdb = admin.database();

// ✅ Use PascalCase for constructors
function Fridge(id) {
    this.deviceId = id;  // ✅ Fixed property name
    this.temperature = (Math.random() * 6 + 2).toFixed(2);
    this.humidity = (Math.random() * 20 + 40).toFixed(2);
    this.doorStatus = Math.random() > 0.7 ? 'open' : 'closed';
    this.timestamp = new Date().toISOString();
}

async function sendDataToFirebase(data) {
    try {
        // Update RTDB with latest data
        await rtdb.ref(`refrigerators/${data.deviceId}`).set({
            temperature: data.temperature,
            humidity: data.humidity,
            doorStatus: data.doorStatus,
            timestamp: data.timestamp
        });

        // Add to Firestore history
        await db.collection('refrigerators')
            .doc(data.deviceId)
            .set({
                temperature: data.temperature,
                doorStatus: data.doorStatus,
                timestamp: data.timestamp,
                lastUpdated: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true }),

            // Add to history collection
            await db.collection('refrigerators')
                .doc(data.deviceId)
                .collection('history')
                .add({
                    temperature: data.temperature,
                    doorStatus: data.doorStatus,
                    timestamp: data.timestamp,
                    savedAt: admin.firestore.FieldValue.serverTimestamp()
                })

        console.log(`✅ Data sent for ${data.deviceId}`);
    } catch (error) {
        console.error(`❌ Firebase error for ${data.deviceId}:`, error.message);
    }
}

async function sendMockFridgeData() {
    console.log('--- Sending batch ---');

    const promises = [];
    for (let i = 1; i <= 5; i++) {
        const fridgeId = `FRIDGE_${String(i).padStart(3, '0')}`;
        const fridgeData = new Fridge(fridgeId);
        promises.push(sendDataToFirebase(fridgeData));
    }

    // ✅ Send all in parallel (faster)
    await Promise.all(promises);
}

// ✅ Store interval reference
const intervalId = setInterval(sendMockFridgeData, 30000);

// ✅ Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down gracefully...');
    clearInterval(intervalId);

    try {
        await admin.app().delete();
        console.log('✅ Firebase connection closed');
    } catch (err) {
        console.error('Error closing Firebase:', err);
    }

    process.exit(0);
});

console.log('🚀 Fridge monitor started! Press Ctrl+C to stop.');
// Run immediately first time
sendMockFridgeData();