import paho.mqtt.client as mqtt

def on_connect(client, userdata, flags, rc):
    print(f"connected with result code {str(rc)}")
    client.subscribe("#")

def on_message(client, userdata, msg):
    print(f"on {msg.topic}, msg: {str(msg.payload)}")


def main():
    client = mqtt.Client()
    client.on_connect = on_connect
    client.on_message = on_message

    client.connect("localhost", 1883, 60)

    client.loop_forever()


if __name__ == '__main__':
    main()
