import React, { Suspense, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import type { AutomergeUrl, DocHandle, Repo } from '@automerge/automerge-repo/slim';
import { RepoContext, useDocument } from '@automerge/automerge-repo-react-hooks';
import type { OpenDocumentEventDetail } from '@inkandswitch/patchwork-elements';
import type { TaskQueueDoc } from './datatype';
import { WorkerPoolProxy } from './worker-pool-proxy';
import { getAccountDocUrl, getTaskQueues } from './helpers';

// The badge for each queue this user contributes to, and the thing that starts
// this browser's task workers: wherever it's on screen, the workers are running.
// It's offered two ways because frames differ in where they put such things.
// Threepane has a title bar it fills from a list on the account; the tiling
// frame has no title bar slots but shows every system-tray component there is.

/** The badge as a title bar tool: threepane, once it's on the account's list. */
export const TitlebarTool = (_handle: DocHandle<unknown>, element: HTMLElement) =>
  mountTaskStatus(element, (element as any).repo);

/** The badge as a system-tray component: any frame with a tray. */
export const TaskTray = (element: HTMLElement, repo?: Repo) =>
  mountTaskStatus(element, repo ?? (element as any).repo ?? (window as any).repo);

function mountTaskStatus(element: HTMLElement, repo: Repo) {
  const root = createRoot(element);
  root.render(
    <RepoContext.Provider value={repo}>
      <Suspense fallback={null}>
        <TaskStatus element={element} />
      </Suspense>
    </RepoContext.Provider>,
  );
  return () => root.unmount();
}

/**
 * This tab's connection to the task workers. One a tab, kept for as long as the
 * tab lives: the badge comes and goes (a title bar tool is mounted afresh for
 * every document) and may be on screen twice, and neither should start the
 * workers twice or let go of them in between. It's kept on `window` so that a
 * newer copy of this package, loaded without a reload, finds it too.
 */
function ensureWorkerPool(contactUrl: AutomergeUrl) {
  const tab = window as any;
  const existing: WorkerPoolProxy | undefined = tab.__patchworkTaskWorkerPool;
  if (existing?.contactUrl === contactUrl) {
    return;
  }
  existing?.dispose();
  const proxy = new WorkerPoolProxy(contactUrl, getImportMap(), document.baseURI);
  console.log('tasks: created worker pool proxy', proxy);
  tab.__patchworkTaskWorkerPool = proxy;
}

const TaskStatus: React.FC<{ element: HTMLElement }> = ({ element }) => {
  const [accountDoc] = useDocument<any>(getAccountDocUrl(), { suspense: true });
  const selfContactUrl: AutomergeUrl = accountDoc.contactUrl;
  const taskQueueUrls = getTaskQueues(accountDoc);

  useEffect(() => {
    ensureWorkerPool(selfContactUrl);
  }, [selfContactUrl]);

  return (
    <div className="task-titlebar-list">
      {Object.keys(taskQueueUrls).map((taskQueueUrl) => (
        <Suspense key={taskQueueUrl} fallback={null}>
          <TaskQueue
            element={element}
            taskQueueUrl={taskQueueUrl as AutomergeUrl}
          />
        </Suspense>
      ))}
    </div>
  );
};

const TaskQueue: React.FC<{ element: HTMLElement; taskQueueUrl: AutomergeUrl }> = ({
  element,
  taskQueueUrl,
}) => {
  const [{ title, pending, done }] = useDocument<TaskQueueDoc>(taskQueueUrl, { suspense: true });
  const name = title ?? 'Tasks';
  const busy = pending.length > 0;
  return (
    <button
      className={`task-titlebar ${busy ? 'task-titlebar--busy' : ''}`}
      title={`${name}: ${pending.length} pending, ${done.length} done`}
      onClick={() => element.dispatchEvent(createOpenEvent({ url: taskQueueUrl }))}
    >
      <span className="task-titlebar-dot" />
      <span className="task-titlebar-name">{name}</span>
      <span className="task-titlebar-count">
        {busy ? `${pending.length} pending` : `${done.length.toLocaleString()} done`}
      </span>
    </button>
  );
};

function createOpenEvent(detail: OpenDocumentEventDetail) {
  const openEvent = new CustomEvent('patchwork:open-document', {
    detail,
    bubbles: true,
    composed: true,
  });
  return openEvent;
}

function getImportMap() {
  const importMapElement = document.querySelector('script[type="importmap"]');
  if (!importMapElement) {
    return {};
  }

  try {
    return JSON.parse(importMapElement.textContent || '{}');
  } catch (e) {
    console.warn('Failed to parse import map:', e);
    return {};
  }
}
