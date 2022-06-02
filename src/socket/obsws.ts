/* obsws.ts */

'use strict'
import { OBSMessage, OBSEvents } from './interfaces'
import { EventSystem } from './events'
import { wait_for } from './timers'
import { hasher } from './hash'
import { parse, stringify, parse_host } from './parse'

// ---

export interface OBSWebSocketOpts {
  host: string
  password: string
}

const DefaultOpts: OBSWebSocketOpts = {
  host: 'http://localhost:4444',
  password: ''
}

export default class OBSWebSocket {
  public events: EventSystem<OBSEvents>
  readonly host: string
  private password: string
  private connected: Boolean
  private messageid: number
  private buffer: Map<string | number, OBSMessage>
  private opts: OBSWebSocketOpts
  private websocket?: WebSocket
  private error_message?: string = undefined

  constructor(opts: OBSWebSocketOpts = DefaultOpts) {
    this.opts = opts
    this.host = parse_host(opts.host)
    this.password = opts.password
    this.messageid = 1
    this.connected = false
    this.buffer = new Map()
    this.events = new EventSystem()
  }

  get isconnected(): Boolean {
    return this.connected
  }

  get error() {
    return this.error_message
  }

  protected next_uuid(): string {
    return String(this.messageid++)
  }

  async start() {
    this.websocket = new WebSocket(this.host)
    this.websocket.onopen = this.auth_handler.bind(this)
    this.websocket.onmessage = this.message_handler.bind(this)
  }

  async send(request: string, payload?: OBSMessage): Promise<string> {
    let message = payload || {}
    message.message_id = this.next_uuid()
    message.request_type = request

    this.websocket?.send(stringify(message))

    return message.message_id
  }

  async call(request: string, payload?: OBSMessage): Promise<OBSMessage> {
    let message_id = await this.send(request, payload)

    await wait_for(() => this.buffer.has(message_id))

    return this.buffer.get(message_id) as OBSMessage
  }

  protected async message_handler(event: MessageEvent): Promise<void> {
    let message: OBSMessage = parse(event)
    let id = message.message_id
    let update = message.update_type as string

    if (id) this.buffer.set(id, message)

    switch (update) {
      case 'TransitionBegin':
        this.events.emit(
          'SwitchScenes',
          message.from_scene as string,
          message.to_scene as string
        )
    }
  }

  protected async auth_handler(): Promise<void> {
    let res: OBSMessage = await this.call('GetAuthRequired')

    if (res.authRequired && res.salt && res.challenge) {
      let hash = hasher(this.password, res.salt, res.challenge)

      res = await this.call('Authenticate', { auth: hash })
    }

    if (res.error) {
      this.error_message = res.error
      return
    }

    this.connected = true
  }

  async get_scene_list(exclude: string = '.'): Promise<OBSMessage> {
    let active: number
    let scenes: String[] = []
    let response = await this.call('GetSceneList')

    for (let scene of response.scenes)
      if (!scene.name.startsWith(exclude)) scenes.push(scene.name)

    active = scenes.indexOf(response.current_scene as string)

    return { scenes, active }
  }

  async switch_to_scene(scene: string): Promise<void> {
    await this.call('SetCurrentScene', { scene_name: scene })
  }
}
