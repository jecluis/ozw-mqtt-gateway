import paho.mqtt.client as mqtt
import json
import time


class Foo:
	is_connected = False

foo = Foo()

def on_connect(client: mqtt.Client, userdata, flags, rc):
	print(f"connected with result code {str(rc)}")
	foo.is_connected = True

def on_message(client, userdata, msg):
    print(f"message >> on {msg.topic} > {str(msg.payload)}")


def main():
	client = mqtt.Client()
	client.on_connect = on_connect
	client.on_message = on_message

	client.connect("localhost", 1883, 60)
	client.loop_start()

	print("waiting for connected")
	while not foo.is_connected:
		time.sleep(1)
		print("waiting...")
	
	print("is connected")

	# client.subscribe("#")
	client.subscribe(("#", 0), ("ozw/action/return", 0))

	time.sleep(5.0)

	client.publish("ozw/action/request", json.dumps({
		'command': -1,
		'nonce': 'aaa'
	}))

	time.sleep(5.0)

	print("send device add")
	client.publish("ozw/action/request", json.dumps({
		'command': 1,
		'nonce': 'bbb'
	}))

	time.sleep(20.0)
	print("cancel last command")
	client.publish("ozw/action/request", json.dumps({
		'command': 17,
		'nonce': 'ccc'
	}))

	time.sleep(5.0)
	client.loop_stop()


if __name__ == '__main__':
    main()
