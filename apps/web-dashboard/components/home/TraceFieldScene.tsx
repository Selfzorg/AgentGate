"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

const NODE_COUNT = 144;

export function TraceFieldScene() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const hostElement = containerRef.current;
    if (hostElement === null) return;
    const host: HTMLDivElement = hostElement;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    camera.position.set(0, 0.6, 18);

    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: "high-performance"
    });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.domElement.dataset.traceField = "active";
    renderer.domElement.style.display = "block";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.width = "100%";
    host.appendChild(renderer.domElement);

    const field = new THREE.Group();
    scene.add(field);

    const nodePositions = new Float32Array(NODE_COUNT * 3);
    const nodeColors = new Float32Array(NODE_COUNT * 3);
    const emerald = new THREE.Color("#5ff0a5");
    const white = new THREE.Color("#f8fff9");
    const dim = new THREE.Color("#163328");

    for (let index = 0; index < NODE_COUNT; index += 1) {
      const angle = index * 0.74;
      const lane = index % 9;
      const radius = 2.4 + lane * 0.58 + Math.sin(index * 1.7) * 0.38;
      const height = Math.cos(index * 0.39) * 2.3 + Math.sin(index * 0.11) * 1.2;

      nodePositions[index * 3] = Math.cos(angle) * radius;
      nodePositions[index * 3 + 1] = height;
      nodePositions[index * 3 + 2] = Math.sin(angle) * radius - 1.8;

      const mixed = dim.clone().lerp(index % 7 === 0 ? white : emerald, 0.45 + (index % 5) * 0.1);
      nodeColors[index * 3] = mixed.r;
      nodeColors[index * 3 + 1] = mixed.g;
      nodeColors[index * 3 + 2] = mixed.b;
    }

    const nodesGeometry = new THREE.BufferGeometry();
    nodesGeometry.setAttribute("position", new THREE.BufferAttribute(nodePositions, 3));
    nodesGeometry.setAttribute("color", new THREE.BufferAttribute(nodeColors, 3));

    const nodesMaterial = new THREE.PointsMaterial({
      size: 0.085,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false
    });
    const nodes = new THREE.Points(nodesGeometry, nodesMaterial);
    field.add(nodes);

    const linePositions: number[] = [];
    const readNodePosition = (nodeIndex: number, axis: number) => nodePositions[nodeIndex * 3 + axis] ?? 0;
    for (let index = 0; index < NODE_COUNT - 12; index += 3) {
      const target = index + 9 + (index % 3);
      linePositions.push(
        readNodePosition(index, 0),
        readNodePosition(index, 1),
        readNodePosition(index, 2),
        readNodePosition(target, 0),
        readNodePosition(target, 1),
        readNodePosition(target, 2)
      );
    }

    const linesGeometry = new THREE.BufferGeometry();
    linesGeometry.setAttribute("position", new THREE.Float32BufferAttribute(linePositions, 3));
    const linesMaterial = new THREE.LineBasicMaterial({
      color: "#50d88c",
      transparent: true,
      opacity: 0.15
    });
    const lines = new THREE.LineSegments(linesGeometry, linesMaterial);
    field.add(lines);

    const rings = [3.6, 5.2, 6.7].map((radius, index) => {
      const geometry = new THREE.TorusGeometry(radius, 0.012, 8, 180);
      const material = new THREE.MeshBasicMaterial({
        color: index === 0 ? "#f5fff7" : "#50d88c",
        transparent: true,
        opacity: index === 0 ? 0.16 : 0.1
      });
      const ring = new THREE.Mesh(geometry, material);
      ring.rotation.x = Math.PI / 2.7 + index * 0.14;
      ring.rotation.y = index * 0.2;
      field.add(ring);
      return { geometry, material, ring };
    });

    const markerGeometry = new THREE.SphereGeometry(0.12, 18, 18);
    const markerMaterial = new THREE.MeshBasicMaterial({ color: "#baffd1" });
    const marker = new THREE.Mesh(markerGeometry, markerMaterial);
    marker.position.set(3.4, 1.2, 1.2);
    field.add(marker);

    const pointer = { x: 0, y: 0 };
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let animationFrame: number | null = null;

    function resize() {
      const width = Math.max(host.clientWidth, 1);
      const height = Math.max(host.clientHeight, 1);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    }

    function handlePointerMove(event: PointerEvent) {
      const bounds = host.getBoundingClientRect();
      pointer.x = ((event.clientX - bounds.left) / Math.max(bounds.width, 1) - 0.5) * 2;
      pointer.y = ((event.clientY - bounds.top) / Math.max(bounds.height, 1) - 0.5) * 2;
    }

    function renderFrame(time: number) {
      const tick = time * 0.00028;
      field.rotation.y = tick + pointer.x * 0.08;
      field.rotation.x = -0.14 + pointer.y * 0.05;
      nodes.rotation.z = Math.sin(tick * 1.7) * 0.025;
      lines.rotation.z = nodes.rotation.z;
      marker.position.x = Math.cos(tick * 3.4) * 3.5;
      marker.position.y = 1.1 + Math.sin(tick * 4.2) * 0.7;

      rings.forEach(({ ring }, index) => {
        ring.rotation.z = tick * (0.8 + index * 0.28);
      });

      renderer.render(scene, camera);
    }

    function animate(time: number) {
      renderFrame(time);
      animationFrame = window.requestAnimationFrame(animate);
    }

    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", handlePointerMove, { passive: true });

    if (prefersReducedMotion) {
      renderFrame(0);
    } else {
      animationFrame = window.requestAnimationFrame(animate);
    }

    return () => {
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", handlePointerMove);
      if (host.contains(renderer.domElement)) host.removeChild(renderer.domElement);
      nodesGeometry.dispose();
      nodesMaterial.dispose();
      linesGeometry.dispose();
      linesMaterial.dispose();
      rings.forEach(({ geometry, material }) => {
        geometry.dispose();
        material.dispose();
      });
      markerGeometry.dispose();
      markerMaterial.dispose();
      renderer.dispose();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 top-0 z-0 h-[760px] overflow-hidden opacity-80 md:h-[900px]"
    />
  );
}
