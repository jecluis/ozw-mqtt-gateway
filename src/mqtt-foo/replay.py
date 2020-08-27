import sys
import json
import paho.mqtt.client as mqtt
import time

if len(sys.argv) < 2:
    print(f"usage: {sys.argv[0]} <logfile>")
    sys.exit(1)

filepath = sys.argv[1]

client = mqtt.Client()
client.connect("localhost", 1883, 60)
client.loop_start()

with open(filepath, 'r') as logfile:

    lines = logfile.readlines()
    for line in lines:
        entry = json.loads(line)
        topic = entry['topic']
        payload = entry['payload']
        payloadstr = json.dumps(payload)
        if not topic.startswith('ozw/'):
            continue

        print(f"> {entry}")
        client.publish(topic, payloadstr)
        time.sleep(0.5)


client.loop_stop()
