import { automergeWasmBase64 } from '@automerge/automerge/automerge.wasm.base64';
import {
  Automerge,
  IndexedDBStorageAdapter,
  MessageChannelNetworkAdapter,
  Repo,
  initSubduction,
} from '@automerge/vanillajs/slim';

export async function getRepo(port: MessagePort, peerId: string) {
  await Promise.all([
    Automerge.initializeBase64Wasm(automergeWasmBase64),
    initSubduction(),
  ]);

  console.log('Automerge & Subduction Wasm initialized');

  const repo = new Repo({
    network: [new MessageChannelNetworkAdapter(port)],
    storage: new IndexedDBStorageAdapter(),
    peerId: peerId as any,
  });

  await repo.networkSubsystem.whenReady();

  return repo;
}
