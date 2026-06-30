import { useCallback, useEffect, useRef, useState } from "react";

import { ZoomPanTransform } from "lib/types";

interface ZoomPanState {
  scale: number;
  translateX: number;
  translateY: number;
}

interface UseZoomPanOptions {
  minScale?: number;
  maxScale?: number;
  zoomSpeed?: number;
  disabled?: boolean;
  contentAspectRatio?: number;
  persistedTransform?: ZoomPanTransform;
  onTransformChange?: (transform: ZoomPanTransform) => void;
}

const DEFAULT_PERSISTED_TRANSFORM: ZoomPanTransform = {
  scale: 1,
  centerX: 0.5,
  centerY: 0.5,
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const finiteOr = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const getContainedContentRect = (
  containerWidth: number,
  containerHeight: number,
  contentAspectRatio?: number,
) => {
  if (
    !contentAspectRatio ||
    !Number.isFinite(contentAspectRatio) ||
    contentAspectRatio <= 0 ||
    containerWidth === 0 ||
    containerHeight === 0
  ) {
    return undefined;
  }

  const containerAspectRatio = containerWidth / containerHeight;
  if (contentAspectRatio >= containerAspectRatio) {
    const height = containerWidth / contentAspectRatio;
    return {
      left: 0,
      top: (containerHeight - height) / 2,
      width: containerWidth,
      height,
    };
  }

  const width = containerHeight * contentAspectRatio;
  return {
    left: (containerWidth - width) / 2,
    top: 0,
    width,
    height: containerHeight,
  };
};

const getBounds = (
  containerWidth: number,
  containerHeight: number,
  scale: number,
  contentAspectRatio?: number,
) => {
  const contentRect = getContainedContentRect(
    containerWidth,
    containerHeight,
    contentAspectRatio,
  );
  if (contentRect) {
    return {
      minTranslateX: Math.min(
        -contentRect.left * scale,
        containerWidth - (contentRect.left + contentRect.width) * scale,
      ),
      maxTranslateX: Math.max(
        -contentRect.left * scale,
        containerWidth - (contentRect.left + contentRect.width) * scale,
      ),
      minTranslateY: Math.min(
        -contentRect.top * scale,
        containerHeight - (contentRect.top + contentRect.height) * scale,
      ),
      maxTranslateY: Math.max(
        -contentRect.top * scale,
        containerHeight - (contentRect.top + contentRect.height) * scale,
      ),
    };
  }

  const contentWidth = containerWidth * scale;
  const contentHeight = containerHeight * scale;

  return {
    minTranslateX: Math.min(0, containerWidth - contentWidth),
    maxTranslateX: 0,
    minTranslateY: Math.min(0, containerHeight - contentHeight),
    maxTranslateY: 0,
  };
};

const clampTransform = (
  transform: ZoomPanState,
  rect: DOMRect,
  minScale: number,
  contentAspectRatio?: number,
): ZoomPanState => {
  if (transform.scale <= minScale) {
    return {
      scale: minScale,
      translateX: 0,
      translateY: 0,
    };
  }

  const bounds = getBounds(
    rect.width,
    rect.height,
    transform.scale,
    contentAspectRatio,
  );
  return {
    scale: transform.scale,
    translateX: clamp(
      transform.translateX,
      bounds.minTranslateX,
      bounds.maxTranslateX,
    ),
    translateY: clamp(
      transform.translateY,
      bounds.minTranslateY,
      bounds.maxTranslateY,
    ),
  };
};

const toPersistedTransform = (
  transform: ZoomPanState,
  rect: DOMRect,
  minScale: number,
  contentAspectRatio?: number,
): ZoomPanTransform => {
  if (transform.scale <= minScale || rect.width === 0 || rect.height === 0) {
    return DEFAULT_PERSISTED_TRANSFORM;
  }

  const contentRect = getContainedContentRect(
    rect.width,
    rect.height,
    contentAspectRatio,
  );
  const centerX = (rect.width / 2 - transform.translateX) / transform.scale;
  const centerY = (rect.height / 2 - transform.translateY) / transform.scale;

  if (contentRect) {
    return {
      scale: transform.scale,
      centerX: clamp((centerX - contentRect.left) / contentRect.width, 0, 1),
      centerY: clamp((centerY - contentRect.top) / contentRect.height, 0, 1),
      viewportAspectRatio: rect.width / rect.height,
    };
  }

  return {
    scale: transform.scale,
    centerX: clamp(centerX / rect.width, 0, 1),
    centerY: clamp(centerY / rect.height, 0, 1),
    viewportAspectRatio: rect.width / rect.height,
  };
};

const fromPersistedTransform = (
  persistedTransform: ZoomPanTransform | undefined,
  rect: DOMRect,
  minScale: number,
  maxScale: number,
  contentAspectRatio?: number,
): ZoomPanState => {
  if (!persistedTransform || rect.width === 0 || rect.height === 0) {
    return {
      scale: 1,
      translateX: 0,
      translateY: 0,
    };
  }

  const scale = clamp(
    finiteOr(persistedTransform.scale, 1),
    minScale,
    maxScale,
  );
  const centerX = clamp(finiteOr(persistedTransform.centerX, 0.5), 0, 1);
  const centerY = clamp(finiteOr(persistedTransform.centerY, 0.5), 0, 1);
  const contentRect =
    persistedTransform.viewportAspectRatio === undefined
      ? undefined
      : getContainedContentRect(rect.width, rect.height, contentAspectRatio);

  const centerPixelX = contentRect
    ? contentRect.left + centerX * contentRect.width
    : centerX * rect.width;
  const centerPixelY = contentRect
    ? contentRect.top + centerY * contentRect.height
    : centerY * rect.height;

  return clampTransform(
    {
      scale,
      translateX: rect.width / 2 - centerPixelX * scale,
      translateY: rect.height / 2 - centerPixelY * scale,
    },
    rect,
    minScale,
    contentAspectRatio,
  );
};

export const useZoomPan = (
  containerRef: React.RefObject<HTMLElement | HTMLDivElement | null>,
  options: UseZoomPanOptions = {},
) => {
  const {
    minScale = 1.0, // Changed from 0.5 to 1.0 to prevent zooming smaller than original
    maxScale = 5, // Can be adjusted as needed
    zoomSpeed = 0.1,
    disabled = false,
    contentAspectRatio,
    persistedTransform,
    onTransformChange,
  } = options;

  const [transform, setTransform] = useState<ZoomPanState>({
    scale: 1,
    translateX: 0,
    translateY: 0,
  });

  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [dragStartTransform, setDragStartTransform] = useState({ x: 0, y: 0 });

  const transformRef = useRef(transform);
  transformRef.current = transform;
  const onTransformChangeRef = useRef(onTransformChange);
  onTransformChangeRef.current = onTransformChange;
  const persistedTransformRef = useRef<ZoomPanTransform>(
    persistedTransform ?? DEFAULT_PERSISTED_TRANSFORM,
  );

  const saveTransform = useCallback(
    (newTransform: ZoomPanState, rect: DOMRect) => {
      const newPersistedTransform = toPersistedTransform(
        newTransform,
        rect,
        minScale,
        contentAspectRatio,
      );
      persistedTransformRef.current = newPersistedTransform;
      onTransformChangeRef.current?.(newPersistedTransform);
    },
    [contentAspectRatio, minScale],
  );

  const applyTransform = useCallback(
    (newTransform: ZoomPanState, rect: DOMRect) => {
      const clampedTransform = clampTransform(
        newTransform,
        rect,
        minScale,
        contentAspectRatio,
      );
      setTransform(clampedTransform);
      saveTransform(clampedTransform, rect);
    },
    [contentAspectRatio, minScale, saveTransform],
  );

  const handleWheel = useCallback(
    (event: Event) => {
      if (disabled) return; // Don't handle wheel events when disabled

      const wheelEvent = event as WheelEvent;
      wheelEvent.preventDefault();

      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const mouseX = wheelEvent.clientX - rect.left;
      const mouseY = wheelEvent.clientY - rect.top;

      // Calculate zoom center relative to current transform
      const currentTransform = transformRef.current;
      const zoomCenterX =
        (mouseX - currentTransform.translateX) / currentTransform.scale;
      const zoomCenterY =
        (mouseY - currentTransform.translateY) / currentTransform.scale;

      // Calculate new scale
      const delta = wheelEvent.deltaY > 0 ? -zoomSpeed : zoomSpeed;
      const newScale = Math.max(
        minScale,
        Math.min(maxScale, currentTransform.scale + delta),
      );

      // If scale is back to minimum (1.0), reset position to center
      if (newScale === minScale) {
        applyTransform(
          {
            scale: newScale,
            translateX: 0,
            translateY: 0,
          },
          rect,
        );
      } else {
        // Calculate new translation to keep zoom center at mouse position
        applyTransform(
          {
            scale: newScale,
            translateX: mouseX - zoomCenterX * newScale,
            translateY: mouseY - zoomCenterY * newScale,
          },
          rect,
        );
      }
    },
    [containerRef, minScale, maxScale, zoomSpeed, disabled, applyTransform],
  );

  const handleMouseDown = useCallback(
    (event: React.MouseEvent) => {
      if (disabled) return; // Don't handle mouse down when disabled
      if (event.button !== 0) return; // Only left mouse button

      // Only allow dragging if zoomed in
      if (transformRef.current.scale <= 1.0) {
        return;
      }

      setIsDragging(true);
      setDragStart({ x: event.clientX, y: event.clientY });
      setDragStartTransform({
        x: transformRef.current.translateX,
        y: transformRef.current.translateY,
      });

      // Prevent text selection and other default behaviors
      event.preventDefault();
      event.stopPropagation();
    },
    [disabled],
  );

  const handleMouseMove = useCallback(
    (event: MouseEvent) => {
      if (!isDragging) return;

      const container = containerRef.current;
      if (!container) return;

      const deltaX = event.clientX - dragStart.x;
      const deltaY = event.clientY - dragStart.y;

      // Calculate new translate values
      const newTranslateX = dragStartTransform.x + deltaX;
      const newTranslateY = dragStartTransform.y + deltaY;

      const containerRect = container.getBoundingClientRect();

      applyTransform(
        {
          scale: transformRef.current.scale,
          translateX: newTranslateX,
          translateY: newTranslateY,
        },
        containerRect,
      );
    },
    [isDragging, dragStart, dragStartTransform, containerRef, applyTransform],
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const resetTransform = useCallback(() => {
    if (disabled) return; // Don't reset when disabled
    const container = containerRef.current;
    if (!container) return;

    applyTransform(
      {
        scale: 1,
        translateX: 0,
        translateY: 0,
      },
      container.getBoundingClientRect(),
    );
  }, [applyTransform, containerRef, disabled]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    setTransform(
      fromPersistedTransform(
        persistedTransform,
        container.getBoundingClientRect(),
        minScale,
        maxScale,
        contentAspectRatio,
      ),
    );
    persistedTransformRef.current =
      persistedTransform ?? DEFAULT_PERSISTED_TRANSFORM;
  }, [containerRef, contentAspectRatio, maxScale, minScale, persistedTransform]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") {
      return undefined;
    }

    const resizeObserver = new ResizeObserver(() => {
      const rect = container.getBoundingClientRect();
      setTransform(
        fromPersistedTransform(
          persistedTransformRef.current,
          rect,
          minScale,
          maxScale,
          contentAspectRatio,
        ),
      );
    });
    resizeObserver.observe(container);

    return () => resizeObserver.disconnect();
  }, [containerRef, contentAspectRatio, maxScale, minScale]);

  // Add event listeners
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }

    container.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      container.removeEventListener("wheel", handleWheel);
    };
  }, [containerRef, handleWheel]);

  useEffect(() => {
    if (!isDragging) {
      return undefined;
    }

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, handleMouseMove, handleMouseUp]);

  const transformStyle = {
    transform: `translate(${transform.translateX}px, ${transform.translateY}px) scale(${transform.scale})`,
    transformOrigin: "0 0",
    cursor: disabled
      ? "default"
      : isDragging
        ? "grabbing"
        : transform.scale > 1.0
          ? "grab"
          : "default",
    transition: isDragging ? "none" : "transform 0.1s ease-out",
  };

  return {
    transform,
    transformStyle,
    isDragging,
    handleMouseDown,
    resetTransform,
    isZoomed:
      transform.scale !== 1.0 ||
      transform.translateX !== 0 ||
      transform.translateY !== 0,
    cursor: disabled
      ? "default"
      : isDragging
        ? "grabbing"
        : transform.scale > 1.0
          ? "grab"
          : "default",
    // Export transform values for overlay
    scale: transform.scale,
    translateX: transform.translateX,
    translateY: transform.translateY,
  };
};
