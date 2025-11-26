require('dotenv').config();
const mqtt = require('mqtt');

const options = {
    host: process.env.MQTT_BROKER,
    port: parseInt(process.env.MQTT_PORT),
    username: process.env.MQTT_USERNAME,
    password: process.env.MQTT_PASSWORD,
    protocol: process.env.MQTT_PORT == 8883 ? 'mqtts' : 'mqtt'
};

console.log('Testing MQTT Connection...\n');
console.log('Configuration:');
console.log(`  Broker: ${options.host}`);
console.log(`  Port: ${options.port}`);
console.log(`  Protocol: ${options.protocol}`);
console.log(`  Username: ${options.username}`);
console.log('');

// Set timeout for connection attempt
const connectionTimeout = setTimeout(() => {
    console.error('❌ Connection Timeout');
    console.log('Could not connect to broker within 10 seconds');
    process.exit(1);
}, 10000);

const client = mqtt.connect(options);

client.on('connect', () => {
    // Clear timeout on successful connection
    clearTimeout(connectionTimeout);
    
    console.log('✅ Connection Successful!');
    console.log(`   Connected to: ${options.host}:${options.port}`);
    console.log('');
    
    // Send test message
    const testTopic = 'test/connection';
    const testMessage = JSON.stringify({
        test: true,
        message: 'Hello from Node.js!',
        timestamp: new Date().toISOString()
    });
    
    client.publish(testTopic, testMessage, { qos: 1 }, (err) => {
        if (err) {
            console.error('❌ Publish Failed:', err);
            process.exit(1);
        } else {
            console.log('✅ Test message published to:', testTopic);
            console.log('   Message:', testMessage);
        }
        
        // Clean exit
        setTimeout(() => {
            client.end(true, () => {
                console.log('\n✅ Test completed successfully!');
                console.log('🎉 Your MQTT broker is working perfectly!\n');
                process.exit(0);
            });
        }, 1000);
    });
});

client.on('error', (err) => {
    clearTimeout(connectionTimeout);
    console.error('❌ Connection Failed:', err.message);
    console.log('\nTroubleshooting:');
    console.log('1. Check your MQTT_BROKER URL in .env');
    console.log('2. Verify MQTT_USERNAME and MQTT_PASSWORD');
    console.log('3. Ensure port 8883 (TLS) or 1883 is correct');
    console.log('4. Check if broker allows external connections');
    process.exit(1);
});
