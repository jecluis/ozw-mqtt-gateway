#
# Copyright (C) 2020  Joao Eduardo Luis <joao@wipwd.dev>
#
# This file is part of wip:wd's openzwave mqtt gateway (ozw-mqtt-gateway). 
# ozw-mqtt-gateway is free software: you can redistribute it and/or modify it
# under the terms of the EUROPEAN UNION PUBLIC LICENSE v1.2, as published by
# the European Comission.
#
import paho.mqtt.client as mqtt_client
import json
import time
import logging
import string
import random
from typing import Dict, List, Any, Optional
from enum import Enum

"""
Pretend to be a zwave/mqtt gateway

We will allow most of the same operations, or as needed, and mimic node and
value events. This will allow us to implement consumers without having to
actually having the controller plugged in, or nodes to play with.

This need comes from having forgotten the controller and the test node in the
same room where a baby is sleeping, and, seriously, you don't want to go there
and risk waking up the little devil.

"""

logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)


class ValueType(Enum):
	NONE		= 0,
	STATIC		= 1,
	STR			= 2,
	INT			= 3,
	FLOAT		= 4


class Value:
	comclass: int
	instance: int
	index: int
	label: str
	units: Optional[str]
	value: Optional[str]
	value_type: ValueType

	def __init__(self, _value_dict: Dict[str, Any]):
		assert 'cls' in _value_dict
		assert 'inst' in _value_dict
		assert 'idx' in _value_dict
		assert 'label' in _value_dict
		assert 'vtype' in _value_dict
		self.comclass = _value_dict['cls']
		self.instance = _value_dict['inst']
		self.index = _value_dict['idx']
		self.value_type = _value_dict['vtype']
		if 'units' in _value_dict:
			self.units = _value_dict['units']
		if 'value' in _value_dict:
			self.value = _value_dict['value']

	def gen_value(self):
		if self.value_type == ValueType.NONE or \
		   self.value_type == ValueType.STATIC:
			return
		elif self.value_type == ValueType.INT:
			self.value = random.randint(0, 100)
		elif self.value_type == ValueType.STR:
			letters = string.ascii_letters
			self.value = ''.join(random.choice(letters) for i in range(0, 30))
		elif self.value_type == ValueType.FLOAT:
			self.value_type = random.uniform(0.0, 100.0)
		else:
			assert "unknown value type" == False


class Node:
	id: int
	product: str
	values: List[Value]

	def __init__(self, _id: int, _product: str):
		self.id = _id
		self.product = _product
		logger.info(f"create node id: {_id}, product: {_product}")

	def init_values(self, _values: List[Value]):
		self.values = _values
		logger.info(f"node id: {self._id} init {len(_values)} values")


class Server:

	nodes: Dict[int, Node]


	def __init__(self):
		self.client = mqtt_client.Client()
		self.client.on_connect = on_connect
		self.client.on_message = on_message
		self.client.connect("localhost", 1883, 60)
		self.client.loop_start()


	def __del__(self):
		self.client.loop_stop()


	def run(self):
		while True:
			time.sleep(0.5)


	def handle(self, msg):
		print(f"handle message: {msg}")



def on_connect(client: mqtt_client.Client, userdata, flags, rc):
	print(f"connected with return code {str(rc)}")
	client.subscribe("ozw/action/#")


def on_message(client: mqtt_client.Client, userdata, msg):
	server.handle(msg)


def main():