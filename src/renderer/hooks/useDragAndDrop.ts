import { useEffect } from "react";

export function useDragAndDrop() {
  useEffect(() => {
    const onDragEnter = (event: DragEvent) => {
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "copy";
      }
    };
    const onDragOver = (event: DragEvent) => {
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "copy";
      }
    };
    const onDrop = (event: DragEvent) => {
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "copy";
      }
    };

    window.addEventListener("dragenter", onDragEnter, true);
    window.addEventListener("dragover", onDragOver, true);
    window.addEventListener("drop", onDrop, true);
    return () => {
      window.removeEventListener("dragenter", onDragEnter, true);
      window.removeEventListener("dragover", onDragOver, true);
      window.removeEventListener("drop", onDrop, true);
    };
  }, []);
}
