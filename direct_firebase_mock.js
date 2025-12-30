const admin = require('firebase-admin');
require('dotenv').config();
const readline = require('readline');
const fs = require('fs');
const path = require('path');

const serviceAccount = require('./firebase-credentials.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL
});

const db = admin.firestore();
const rtdb = admin.database();

// ============================================
// Local Storage File (Persistent)
// ============================================
const LOCAL_STORAGE_FILE = path.join(__dirname, 'device_ids.json');

// ============================================
// In-memory storage (simulates ESP memory)
// ============================================
// Structure: deviceKey -> id | null
const deviceMemory = new Map();

// ============================================
// Local Storage Functions
// ============================================

function loadLocalStorage() {
    try {
        if (fs.existsSync(LOCAL_STORAGE_FILE)) {
            const data = JSON.parse(fs.readFileSync(LOCAL_STORAGE_FILE, 'utf8'));
            for (const [key, id] of Object.entries(data)) {
                deviceMemory.set(key, id);
            }
            console.log(`📂 Loaded ${deviceMemory.size} device(s) from local storage`);
        }
    } catch (error) {
        console.error('❌ Error loading local storage:', error.message);
    }
}

function saveLocalStorage() {
    try {
        const data = Object.fromEntries(deviceMemory);
        fs.writeFileSync(LOCAL_STORAGE_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('❌ Error saving local storage:', error.message);
    }
}

// ============================================
// Generate Random ID
// ============================================

function generateRandomId() {
    const timestamp = Date.now().toString(36);
    const randomPart = Math.random().toString(36).substring(2, 10);
    return `${timestamp}_${randomPart}`;
}

// ============================================
// Generate Reading - temp, humidity, timestamp + id
// ============================================

function generateReading(id) {
    return {
        id: id,
        temp: parseFloat((Math.random() * 6 + 2).toFixed(2)),
        humidity: parseFloat((Math.random() * 20 + 40).toFixed(2)),
        timestamp: new Date().toISOString()
    };
}

// ============================================
// Device Management
// ============================================

function addDevice(deviceKey) {
    if (deviceMemory.has(deviceKey)) {
        console.log(`⚠️  Device "${deviceKey}" already exists`);
        return false;
    }

    deviceMemory.set(deviceKey, null); // No ID yet
    saveLocalStorage();
    console.log(`✅ Device "${deviceKey}" added`);
    return true;
}

async function removeDevice(deviceKey) {
    if (!deviceMemory.has(deviceKey)) {
        console.log(`⚠️  Device "${deviceKey}" not found`);
        return false;
    }

    const id = deviceMemory.get(deviceKey);

    if (id) {
        try {
            await db.collection('readings').doc(id).delete();
            await rtdb.ref(`readings/${id}`).remove();
        } catch (error) {
            console.error(`❌ Cleanup error:`, error.message);
        }
    }

    deviceMemory.delete(deviceKey);
    saveLocalStorage();
    console.log(`✅ Device "${deviceKey}" removed`);
    return true;
}

function listDevices() {
    if (deviceMemory.size === 0) {
        console.log('\n📋 No devices registered\n');
        return;
    }

    console.log('\n📋 Devices:');
    for (const [key, id] of deviceMemory) {
        console.log(`  ${key} → ${id || 'No ID yet'}`);
    }
    console.log('');
}

// ============================================
// Firebase Communication
// ============================================

async function sendDeviceData(deviceKey) {
    const storedId = deviceMemory.get(deviceKey);

    try {
        let id = storedId;

        if (!storedId) {
            // No ID in memory - Generate random ID and create document
            id = generateRandomId();
            const reading = generateReading(id);

            // Create document with ID as document ID
            await db.collection('readings').doc(id).set({
                id: id,
                readings: [reading]
            });

            deviceMemory.set(deviceKey, id); // Store ID in memory
            saveLocalStorage(); // Save to local file

            console.log(`📝 [${deviceKey}] New doc created with ID: ${id}`);

            // Update Realtime Database
            await rtdb.ref(`readings/${id}`).set(reading);

            console.log(`✅ [${deviceKey}] temp: ${reading.temp}°C | humidity: ${reading.humidity}%`);
        } else {
            // ID exists - Update existing document (append to array)
            const reading = generateReading(id);

            await db.collection('readings').doc(id).update({
                readings: admin.firestore.FieldValue.arrayUnion(reading)
            });

            // Update Realtime Database with same ID
            await rtdb.ref(`readings/${id}`).set(reading);

            console.log(`✅ [${deviceKey}] temp: ${reading.temp}°C | humidity: ${reading.humidity}%`);
        }

    } catch (error) {
        console.error(`❌ [${deviceKey}] Error:`, error.message);

        // Reset ID if document not found
        if (error.code === 5 || error.code === 'not-found') {
            deviceMemory.set(deviceKey, null);
            saveLocalStorage();
        }
    }
}

async function sendAllDevicesData() {
    if (deviceMemory.size === 0) return;

    console.log(`\n--- Sending readings (${new Date().toLocaleTimeString()}) ---`);

    const promises = [];
    for (const deviceKey of deviceMemory.keys()) {
        promises.push(sendDeviceData(deviceKey));
    }

    await Promise.all(promises);
}

// ============================================
// CLI
// ============================================

function setupCLI() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    console.log('\nCommands: add <name> | remove <name> | list | exit\n');

    rl.on('line', async (input) => {
        const [command, ...args] = input.trim().split(' ');
        const deviceKey = args.join('_');

        switch (command.toLowerCase()) {
            case 'add':
                if (deviceKey) addDevice(deviceKey);
                else console.log('Usage: add <device_name>');
                break;

            case 'remove':
                if (deviceKey) await removeDevice(deviceKey);
                else console.log('Usage: remove <device_name>');
                break;

            case 'list':
                listDevices();
                break;

            case 'exit':
                process.emit('SIGINT');
                break;

            default:
                if (command) console.log(`Unknown command: ${command}`);
        }
    });

    return rl;
}

// ============================================
// Main
// ============================================

async function main() {
    console.log('🚀 ESP Simulator Started\n');

    // Load existing IDs from local storage
    loadLocalStorage();

    const rl = setupCLI();

    await sendAllDevicesData();

    const intervalId = setInterval(sendAllDevicesData, 5000);

    process.on('SIGINT', async () => {
        console.log('\n🛑 Shutting down...');
        clearInterval(intervalId);
        rl.close();

        saveLocalStorage();

        try {
            await admin.app().delete();
            console.log('✅ Closed');
        } catch (err) {
            console.error('Error:', err.message);
        }

        process.exit(0);
    });
}

main().catch(console.error);