require('dotenv').config();
const mqtt = require('mqtt');

// MQTT Configuration
const options = {
    host: process.env.MQTT_BROKER,
    port: parseInt(process.env.MQTT_PORT),
    username: process.env.MQTT_USERNAME,
    password: process.env.MQTT_PASSWORD,
    protocol: process.env.MQTT_PORT == 8883 ? 'mqtts' : 'mqtt',
    clean: true,
    clientId: `mock_esp32_${Math.random().toString(16).slice(3)}`
};

console.log('🔌 Connecting to MQTT Broker...');
console.log(`   Broker: ${options.host}:${options.port}`);

const client = mqtt.connect(options);

client.on('connect', () => {
    console.log('✅ Mock ESP32 Connected to MQTT Broker\n');
    console.log('📡 Publishing sensor data every 5 seconds...\n');
    
    // Publish data every 5 seconds
    setInterval(() => {
        
        const data = generateSensorData();
        const payload = JSON.stringify(data);
        
        client.publish(process.env.MQTT_TOPIC, payload, { qos: 1 }, (err) => {
            if (err) {
                console.error('❌ Publish Error:', err);
            } else {
                console.log('📤 Published:', {
                    temperature: data.temperature + '°C',
                    humidity: data.humidity + '%',
                    doorStatus: data.doorStatus,
                    timestamp: data.timestamp
                });
            }
        });
    }, 5000);
});

client.on('error', (err) => {
    console.error('❌ MQTT Error:', err);
});

client.on('offline', () => {
    console.log('⚠️  MQTT Client Offline');
});

client.on('reconnect', () => {
    console.log('🔄 Reconnecting to MQTT Broker...');
});


function generateSensorData(
    id='FRIDGE_001',
) {
    return {
        deviceId: id,
        temperature: (Math.random() * 6 + 2).toFixed(2), // 2-8°C
        humidity: (Math.random() * 20 + 40).toFixed(2),  // 40-60%
        doorStatus: Math.random() > 0.7 ? 'open' : 'closed',
        powerStatus: 'on',
        compressorStatus: Math.random() > 0.5 ? 'running' : 'idle',
        timestamp: new Date().toISOString()
    };
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n⛔ Stopping Mock ESP32...');
    client.end(false, () => {
        console.log('✅ Disconnected from MQTT Broker');
        process.exit(0);
    });
});
