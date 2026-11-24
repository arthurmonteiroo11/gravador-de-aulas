/** Troca para a versão nova do app assim que ela chega, mas nunca no meio de uma gravação. */
export function createAppUpdater(apply: () => void) {
  let recording = false;
  let pending = false;
  const tryApply = () => {
    if (pending && !recording) {
      pending = false;
      apply();
    }
  };
  return {
    onNeedRefresh() {
      pending = true;
      tryApply();
    },
    setRecording(value: boolean) {
      recording = value;
      tryApply();
    },
  };
}

let applyUpdate: () => void = () => undefined;
export const appUpdater = createAppUpdater(() => applyUpdate());

export function setUpdateAction(fn: () => void) {
  applyUpdate = fn;
}
