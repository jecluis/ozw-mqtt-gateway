# API


## Overview

For the purposes of this document, we shall split events in three categories:

1) gateway triggered events
2) actions
3) config operations

The first is essentially the stream of events coming from the z-wave driver, and
their topics will be in the form of `<namespace>/<who>/<what>`; as an example,
`ozw/node/add` tells us the driver has emitted an event adding a node to the
network. In the api, all z-wave driver triggered events will follow this
pattern, and shall be documented later on.

Actions are user-driven commands issued to the mqtt gateway, most of which
pertaining to z-wave network operations. These will be in the form of
`<namespace>/action/<state>`, where state will be one of several, but usually
will start by being `request` when issued by the user, and `completed` when
successfully finished by the gateway. By providing a state indicator in the
topic we can easily track progress of, and communicate status for, of user
issued commands.

Finally, the third category pertains to gateway-specific configuration. Given
the `<namespace>` mentioned above refers to the z-wave network, it only exists
once the network has been configured and started; up until that point in time it
simply does not exist, simply is not listened on. As such, we need a different
topic to listen on, and we chose `ozw-mqtt-gateway`. For example,
`ozw-mqtt-gateway/zwave/config/set/request`, which follows much of the pattern
specified above, lets us set the z-wave network's configuration.

It is important to note that despite the gateway listening on both the
`ozw-mqtt-gateway` and `<namespace>` topics, any topic that does not end with
`/request` will be ignored -- the gateway only handles requests from users, and
publishes results. This is also applicable to z-wave events: we never publish
requests for z-wave events, only results and intermediate steps should they exist.


Bellow we will specify the multitude of events, actions, and config operations,
and their topics.


## Gateway Triggered Events

For simplicity's sake, we will assume the default namespace as being `ozw`.


### Driver

### > ozw/driver/connected
### > ozw/driver/ready
### > ozw/driver/failed

```
payload = { 'state': <type: string> }
```

where `<state>` will be one `connected`, `ready`, or `failed` depending on the
event.


### Node

Although `reset` is published, at time of writing we are not doing anything with
it internally, while we do cache the other node operation's values.


### > ozw/node/add
### > ozw/node/remove
### > ozw/node/reset

```
payload = { 'id': <type: number> }
```

### > ozw/node/ready
### > ozw/node/naming
### > ozw/node/available

```
payload = { 'id': <type: number>, 'info': <type: nodeinfo> }
```

### > ozw/node/notification

```
payload = {
    'id': <type: number>,
    'notification': <type: notification>
    'help': <type: string>
}
```


### Value

### > ozw/value/add
### > ozw/value/changed

```
payload = {
    'id': <type: number>,
    'class': <type: number>,
    'value': <type: nodevalue>
}
```

### > ozw/value/remove

```
payload = {
    'id': <type: number>,
    'class': <type: number>,
    'instance': <type: number>,
    'index': <type: number>
}
```

### Miscelaneous

### > ozw/alert

```
payload = { 'notification': <type: notification>, 'help': <type: string> }
```

### > ozw/db

Issued when the underlying vendor database is ready. In practice, this means the
driver is able to resolve product and manufacturer ids to strings, as well as
value-specific strings for a given product.

```
payload = { 'state': 'ready' }
```

### > ozw/controller/scan

Issued when the controller finishes scanning the network. Only has one state:
`completed`.

```
payload = { 'state': 'completed' }
```

### > ozw/controller/command

```
payload = {
    id: <type: number>, // node id
    state: <type: controllerstate>,
    state_str: <type: string>,
    notification: <type: controllererror>,
    message: <type: string>,
    command: <type: number>
}
```

## Actions

An action is an MQTT message received by the gateway, on topic
`ozw/action/request`, with a given payload in the form

```
payload = {'nonce': <type: string>, 'command': <type: number> }
```

Different commands may have additional fields, but at time of writing we haven't
implemented any that do. Then again, at time of writing we are not handling
user-driven value changes, so that would be a good candidate for additional
fields existing in the action payload.

The `command` field is the id of the command being requested; these can be found
n the `types` section. And `nonce` is a user-defined string, solely meant for
the user's benefit in tracking progress of this particular command; its
definition is mandatory.

Actions follow a basic state machine: they all start with a `request` from the
user, and will progress until they `return`, are `cancelled`, `failed` or
`completed`. Inbetween there may be numerous
intermediate steps:

* acknowledged
* inprogress
* error
* starting
* waiting

At any point in time, during a state change, the gateway will emit an event for
any of these states in the form of

```
topic = 'ozw/action/<state>',
payload = {
    rc: <type: number>,   // return code
    str: <type: string>,  // state string (e.g., 'inprogress')
    nonce: <type: string> // user specified nonce
}
```



## Configuration

Configuration commands will all happen on the `ozw-mqtt-gateway` topic. As
explained before, this is for technical reasons and dissociate gateway-specific
actions from network-related actions.

At time of writing, we have the following implemented operations:

### > config set

```
topic = 'ozw-mqtt-gateway/config/set/request'
payload = {
    nonce: <type: string>,
    force: <type: boolean>,
    config: <type: dictionary> // see below for expected config format
}
```

Returns

```
payload = {
    rc: <type: number>,   // return code
    str: <type: string>,  // return string
    nonce: <type: number>
}
```

And the expected config format during set is in the following form:

```
config_payload = {
    config: {
        device: <type: string>
        namespace: <type: string>
    }
}
```

### > config get

```
topic = 'ozw-mqtt-gateway/config/get/request'
payload = {
    nonce: <type: string>
}
```

Returns

```
payload = {
    rc: <type: number>,         // return code
    str: <type: string>,        // return string
    nonce: <type: string>,
    config: <type: dictionary>  // config in the above format
}
```

### > network start

```
topic = 'ozw-mqtt-gateway/network/start/request'
payload = {
    nonce: <type: string>
}
```

### > network stop

```
topic = 'ozw-mqtt-gateway/network/stop/request'
payload = {
    nonce: <type: string>
}
```

### > network status

```
topic = 'ozw-mqtt-gateway/network/status/request'
payload = {
    nonce: <type: string>
}
```

Returns

```
payload = {
    rc: <type: number>,
    str: <type: string>,
    nonce: <type: string>,
    status: {
        is_connected: <type: boolean>,
        is_ready: <type: boolean>,
        is_failed: <type: boolean>
    }
}
```


## Types

asdasd

### Commands

NOTE: Not all of these are currently implemented.

```
	None                        = 0,
	AddDevice                   = 1,
	CreateNewPrimary            = 2,
	ReceiveConfiguration        = 3,
	RemoveDevice                = 4,
	RemoveFailedNode            = 5,
	HasNodeFailed               = 6,
	ReplaceFailedNode           = 7,
	TransferPrimaryRole         = 8,
	RequestNetworkUpdate        = 9,
	RequestNodeNeighborUpdate   = 10,
	AssignReturnRoute           = 11,
	DeleteAllReturnRoutes       = 12,
	SendNodeInformation         = 13,
	ReplicationSend             = 14,
	CreateButton                = 15,
	DeleteButton                = 16,
	CancelCommand				= 17,
	GetLatestState				= 18,
	NotACommand					= 19, // increase on additional commands.
```