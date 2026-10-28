import { useEffect, useRef } from 'react';

export default function PaperBackground({ animOn, lowIntensity }) {
  const containerRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.innerHTML = '';
    if (!animOn || lowIntensity) return;
    const isTouch = window.matchMedia('(max-width: 768px), (pointer: coarse)').matches;
    const paperCount = lowIntensity ? 3 : (isTouch ? 4 : 9);
    for (let i = 0; i < paperCount; i++) {
      const paper = document.createElement('div');
      paper.classList.add('paper');
      const size = Math.random() * 40 + 40;
      paper.style.width = `${size}px`;
      paper.style.height = `${size * 1.3}px`;
      paper.style.left = `${Math.random() * 100}vw`;
      paper.style.animationDuration = `${Math.random() * 10 + 18}s`;
      paper.style.animationDelay = `${Math.random() * -20}s`;
      paper.style.transform = `rotate(${Math.random() * 360}deg)`;
      container.appendChild(paper);
    }

    let frameId = 0;
    const onMove = (event) => {
      if (frameId) return;
      frameId = requestAnimationFrame(() => {
        const x = (event.clientX / window.innerWidth - 0.5) * 28;
        const y = (event.clientY / window.innerHeight - 0.5) * 18;
        container.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        frameId = 0;
      });
    };
    const canParallax = window.matchMedia('(pointer: fine) and (prefers-reduced-motion: no-preference)').matches;
    if (canParallax) window.addEventListener('mousemove', onMove, { passive: true });
    return () => {
      if (canParallax) window.removeEventListener('mousemove', onMove);
      if (frameId) cancelAnimationFrame(frameId);
    };
  }, [animOn, lowIntensity]);

  return <div className="paper-container" id="paper-container" ref={containerRef}></div>;
}
