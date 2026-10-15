/**
 * 메인 ↔ 화면 통신 계약.
 *
 * 기능마다 `src/shared/ipc/<기능>.ts` 파일에서 아래 인터페이스를 선언 병합(declaration merging)으로
 * 확장한다. 이 파일 자체는 기능 작업이 고치지 않는다. 예시는 `./app.ts`.
 *
 *   declare module './contract' {
 *     interface IpcInvokeChannels { 'pins:list': { req: void; res: Pin[] } }
 *     interface IpcEventChannels { 'cache:changed': { scopes: string[] } }
 *   }
 *
 * 채널 이름 규칙: `<기능>:<동작>` (예: `app:info`, `pins:reorder`).
 */

/* eslint-disable @typescript-eslint/no-empty-object-type */
/** 요청-응답 채널: 화면이 invoke 하고 메인이 handle 한다. */
export interface IpcInvokeChannels {}
/** 이벤트 채널: 메인이 모든 창에 보낸다. */
export interface IpcEventChannels {}
/* eslint-enable @typescript-eslint/no-empty-object-type */

export type InvokeChannel = keyof IpcInvokeChannels
export type EventChannel = keyof IpcEventChannels

export type InvokeRequest<C extends InvokeChannel> = IpcInvokeChannels[C] extends { req: infer R }
  ? R
  : never
export type InvokeResponse<C extends InvokeChannel> = IpcInvokeChannels[C] extends { res: infer R }
  ? R
  : never
export type EventPayload<E extends EventChannel> = IpcEventChannels[E]

/** 요청 값이 void 인 채널은 인자 없이 호출한다. */
export type InvokeArgs<C extends InvokeChannel> = [InvokeRequest<C>] extends [void]
  ? []
  : [InvokeRequest<C>]

/** 프리로드가 `window.gdesk` 로 노출하는 API. */
export interface GdeskApi {
  invoke<C extends InvokeChannel>(channel: C, ...args: InvokeArgs<C>): Promise<InvokeResponse<C>>
  on<E extends EventChannel>(event: E, listener: (payload: EventPayload<E>) => void): () => void
}
