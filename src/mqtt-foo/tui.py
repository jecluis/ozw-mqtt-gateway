from prompt_toolkit import Application
from prompt_toolkit.buffer import Buffer
from prompt_toolkit.layout.layout import Layout
from prompt_toolkit.layout.containers import (
	HSplit, Window
)
from prompt_toolkit.layout.controls import BufferControl
from prompt_toolkit.key_binding import KeyBindings
from prompt_toolkit.key_binding.bindings.focus import (
	focus_next, focus_previous
)
from prompt_toolkit.widgets import (
	Frame, HorizontalLine, SearchToolbar, TextArea
)
from prompt_toolkit.completion import NestedCompleter

import asyncio
import paho.mqtt.client as mqtt
import random
import string
import json



class MQTTClient:

	client: mqtt.Client
	is_connected: bool
	buffer: Buffer


	def __init__(self, buffer):
		self.client = mqtt.Client()
		self.is_connected = False
		self.client.on_connect = self.on_connect
		self.client.on_message = self.on_message
		self.buffer = buffer


	def start(self):
		self.client.connect("localhost", 1883, 60)
		self.client.loop_start()

	def stop(self):
		self.client.disconnect()
		self.client.loop_stop()

	def on_connect(self, client: mqtt.Client, userdata, flags, rc):
		self.is_connected = True
		if rc == 0:
			self.buffer.insert_text(
				"mqtt > connected to localhost:1883")
			self.buffer.newline()
		else:
			self.buffer.insert_text(
				f"mqtt > error connecting (rc = {rc}")
			self.buffer.newline()
		client.subscribe("ozw/#")
		client.subscribe("ozw-mqtt-gateway/zwave/#")


	def on_message(self, client, userdata, msg):
		self.buffer.insert_text(f"mqtt > message > topic: {msg.topic}")
		self.buffer.newline()
		payload = json.loads(msg.payload)
		payload_str = json.dumps(payload, indent=4)
		self.buffer.insert_text(f"msg: {payload_str}")
		self.buffer.newline()
		# self.buffer.insert_text(
		# 	f"mqtt > message > topic: {msg.topic} || {str(msg.payload)}"
		# )
		# self.buffer.newline()

	def get_random_str(self):
		return ''.join(random.choice(string.ascii_letters) for i in range(15))

	def do_command(self, cmdstr: str):
		if not cmdstr:
			return

		cmd_lst = cmdstr.split()
		cmd_args = cmd_lst[1:]
		assert len(cmd_lst) > 0
		cmd = cmd_lst[0]
		action = {}
		if cmd == "cancel":
			action = {
				'command': 17, # cancel
				'nonce': self.get_random_str()
			}

		elif cmd == "node":
			assert len(cmd_args) > 0
			subcmd = cmd_args[0]
			if subcmd != "add" and subcmd != "rm":
				self.buffer.insert_text(f"-> unknown command 'node {subcmd}'")
				self.buffer.newline()
				return
			cmd_id = 1 # node add
			if subcmd == "rm":
				cmd_id = 4 # node remove
			action = {
				'command': cmd_id,
				'nonce': self.get_random_str()
			}
		elif cmd == "get-state":
			action = {
				'command': 18, # get state
				'nonce': self.get_random_str()
			}
		elif cmd == "config":
			assert len(cmd_args) > 0
			subcmd = cmd_args[0]
			if subcmd == "get":
				action = {
					'nonce': self.get_random_str()
				}
				self.client.publish(
					"ozw-mqtt-gateway/zwave/config/get/request",
					json.dumps(action))
				return
			elif subcmd == "set":
				args = cmd_args[1:]
				if len(args) < 4:
					self.buffer.insert_text(
						"usage: config set device <dev> namespace <ns> [force]")
					self.buffer.newline()
					return
				dev = args[1]
				ns = args[3]

				force = False
				if len(args) == 5 and args[4] == "force":
					force = True

				action = {
					'nonce': self.get_random_str(),
					'config': {
						'device': dev,
						'namespace': ns
					},
					'force': force
				}

				self.client.publish(
					"ozw-mqtt-gateway/zwave/config/set/request",
					json.dumps(action))
				return
		elif cmd == "network":
			allowed_cmds = ["start", "stop", "status"]
			if len(cmd_args) == 0 or cmd_args[0] not in allowed_cmds:
				allowed_str = "|".join(allowed_cmds)
				self.buffer.insert_text(f"usage: network <{allowed_str}>")
				self.buffer.newline()
				return
			topic = f"network/{cmd_args[0]}"
			action = {
				'nonce': self.get_random_str(),
			}
			self.client.publish(
				f"ozw-mqtt-gateway/zwave/{topic}/request",
				json.dumps(action))
			return
		else:
			self.buffer.insert_text(f"-> unknown command '{cmd}'")
			self.buffer.newline()
			return

		self.buffer.insert_text(f"-> cmd: {cmdstr}")
		self.buffer.newline()
		self.client.publish("ozw/action/request", json.dumps(action))



subscription_buffer = Buffer()
subscription_window = Window(
	content=BufferControl(buffer=subscription_buffer),
	always_hide_cursor=True)



def input_accept_handler(buffer: Buffer):
	try:
		cmd: str = buffer.text
		if not cmd:
			return
		# subscription_buffer.insert_text(f"-> cmd: {cmd}")
		# subscription_buffer.newline()
		client.do_command(cmd)

	except Exception as e:
		subscription_buffer.insert_text(str(e))
		subscription_buffer.newline()


cmd_completer = NestedCompleter.from_nested_dict({
	'node': {
		'add': None,
		'rm': None,
	},
	'value': {
		'refresh': None,
		'list': None,
		'get': None
	}
})

search = SearchToolbar()
input_field = TextArea(
	height=1,
	prompt=">>> ",
	# style="class:input-field",
	multiline=False,
	wrap_lines=False,
	search_field=search,
	accept_handler=input_accept_handler,
	completer=cmd_completer
)

root_container = HSplit([
	Frame(body=subscription_window),
	input_field
])

layout = Layout(root_container, focused_element=input_field)
kb = KeyBindings()

@kb.add('c-q')
@kb.add('c-d')
def event_exit(event):
	client.stop()
	event.app.exit()

@kb.add('c-l')
def event_clear(event):
	subscription_buffer.text = ""

@kb.add('c-c')
def event_clear_input(event):
	input_field.text = ""

kb.add("tab")(focus_next)
kb.add("s-tab")(focus_previous)


client = MQTTClient(subscription_buffer)

async def main():
	app = Application(layout=layout, full_screen=True, key_bindings=kb)
	app_task = app.run_async()
	try:
		client.start()
	except Exception as e:
		subscription_buffer.insert_text(str(e))
		subscription_buffer.newline()
	await app_task

asyncio.get_event_loop().run_until_complete(main())