"use client";

import { useEffect, useRef } from "react";
import { Box } from "@chakra-ui/react";

interface SpiritPortalProps {
    variant?: "default" | "onboarding";
}

export const SpiritPortal = ({ variant = "default" }: SpiritPortalProps) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    // Store mouse position (start off-screen)
    const mouseRef = useRef({ x: -1000, y: -1000 });

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext("2d", { alpha: true });
        if (!ctx) return;

        let animationFrameId: number;
        let particles: Particle[] = [];

        // Configuration for "Ultra-Minimal" look (Refined for Visibility)
        const CONFIG = {
            particleCount: 60, // Slight increase
            maxOpacity: 0.35, // Increased from 0.15 to be visible
            magnetRadius: 250,
            magnetForce: 0.08,
            friction: 0.94,
            colors: [
                { r: 0, g: 250, b: 238 },
                { r: 102, g: 25, b: 255 },
                { r: 200, g: 230, b: 255 },
            ],
            blurStrength: 20,
        };

        // Resize Handler
        const resize = () => {
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            canvas.width = window.innerWidth * dpr;
            canvas.height = window.innerHeight * dpr;
            ctx.scale(dpr, dpr);
            canvas.style.width = `${window.innerWidth}px`;
            canvas.style.height = `${window.innerHeight}px`;
        };
        window.addEventListener("resize", resize);
        resize();

        // Mouse Handler
        const onMouseMove = (e: MouseEvent) => {
            mouseRef.current = { x: e.clientX, y: e.clientY };
        };
        window.addEventListener("mousemove", onMouseMove);

        class Particle {
            x: number;
            y: number;
            vx: number;
            vy: number;
            size: number;
            life: number;
            maxLife: number;
            color: { r: number, g: number, b: number };

            constructor(w: number, h: number) {
                this.x = Math.random() * w;
                this.y = Math.random() * h;
                // Extremely slow drift
                this.vx = (Math.random() - 0.5) * 0.1;
                this.vy = (Math.random() - 0.5) * 0.1;
                this.size = Math.random() * 2 + 1; // Small source point
                this.life = Math.random() * 200;
                this.maxLife = 200 + Math.random() * 100; // Long life
                this.color = CONFIG.colors[Math.floor(Math.random() * CONFIG.colors.length)];
            }

            update(w: number, h: number) {
                // 1. Mouse Attraction (Magnetic)
                const mx = mouseRef.current.x;
                const my = mouseRef.current.y;
                const dx = mx - this.x;
                const dy = my - this.y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (dist < CONFIG.magnetRadius) {
                    // Inverse distance force
                    const force = (1 - dist / CONFIG.magnetRadius) * CONFIG.magnetForce;
                    this.vx += dx * force * 0.02;
                    this.vy += dy * force * 0.02;
                }

                // 2. Physics
                this.x += this.vx;
                this.y += this.vy;

                // Friction (Damping)
                this.vx *= CONFIG.friction;
                this.vy *= CONFIG.friction;

                // Innate Brownian motion (so they don't stop completely)
                this.vx += (Math.random() - 0.5) * 0.01;
                this.vy += (Math.random() - 0.5) * 0.01;

                // 3. Life Cycle
                this.life++;
                if (this.life > this.maxLife) {
                    this.reset(w, h);
                }

                const padding = 100;
                if (this.x < -padding) this.x = w + padding;
                if (this.x > w + padding) this.x = -padding;
                if (this.y < -padding) this.y = h + padding;
                if (this.y > h + padding) this.y = -padding;
            }

            reset(w: number, h: number) {
                this.life = 0;
                this.x = Math.random() * w;
                this.y = Math.random() * h;
                this.vx = (Math.random() - 0.5) * 0.1;
                this.vy = (Math.random() - 0.5) * 0.1;
            }

            draw() {
                if (!ctx) return;

                // Circular Mask Calculation
                const w = window.innerWidth;
                const h = window.innerHeight;
                const cx = w / 2;
                const cy = h / 2;
                const distFromCenter = Math.sqrt((this.x - cx) ** 2 + (this.y - cy) ** 2);

                // Define Portal Radius (approx 45% of screen min dimension)
                const portalRadius = Math.min(w, h) * 0.45;
                let maskAlpha = 1;

                // Soft edge fade for the portal circle
                if (distFromCenter > portalRadius) {
                    const fadeDist = 150; // pixels to fade out
                    const delta = distFromCenter - portalRadius;
                    maskAlpha = Math.max(0, 1 - delta / fadeDist);
                }

                // If outside mask, don't draw (optimization)
                if (maskAlpha <= 0) return;

                // Life Opacity (Fade in/out)
                const lifeProgress = this.life / this.maxLife;
                // Sine wave for smooth fade in and out
                const lifeAlpha = Math.sin(lifeProgress * Math.PI);

                const finalAlpha = lifeAlpha * maskAlpha * CONFIG.maxOpacity;

                if (finalAlpha <= 0.001) return;

                // Draw with "Add" blend for glow
                // Using a large radial gradient for soft "wisp" look
                const g = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, this.size * CONFIG.blurStrength);
                g.addColorStop(0, `rgba(${this.color.r}, ${this.color.g}, ${this.color.b}, ${finalAlpha})`);
                g.addColorStop(0.5, `rgba(${this.color.r}, ${this.color.g}, ${this.color.b}, ${finalAlpha * 0.5})`);
                g.addColorStop(1, `rgba(${this.color.r}, ${this.color.g}, ${this.color.b}, 0)`);

                ctx.fillStyle = g;
                ctx.beginPath();
                // Draw larger rect/circle to accommodate gradient
                ctx.arc(this.x, this.y, this.size * CONFIG.blurStrength, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // Init
        const init = () => {
            particles = [];
            for (let i = 0; i < CONFIG.particleCount; i++) {
                particles.push(new Particle(window.innerWidth, window.innerHeight));
            }
        };
        init();

        const animate = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            // Use "screen" or "lighter" for that ethereal glowing look
            ctx.globalCompositeOperation = "lighter";

            particles.forEach(p => {
                p.update(window.innerWidth, window.innerHeight);
                p.draw();
            });

            ctx.globalCompositeOperation = "source-over";
            animationFrameId = requestAnimationFrame(animate);
        };
        animate();

        return () => {
            window.removeEventListener("resize", resize);
            window.removeEventListener("mousemove", onMouseMove);
            cancelAnimationFrame(animationFrameId);
        };
    }, []);

    return (
        <Box
            position="absolute"
            top="0"
            left="0"
            w="100%"
            h="100%"
            zIndex={0}
            overflow="hidden"
            bg="#06080F"
        >
            {/* Base Image */}
            <Box
                position="absolute"
                inset="0"
                backgroundImage="url('/nature_privacy_portal_bg.png')"
                backgroundSize="cover"
                backgroundPosition="center center" // Keeps portal centered on cropped mobile view
                backgroundAttachment="fixed" // Parallax-like fix
                // Darker to let subtle particles show
                filter={variant === 'onboarding' ? "brightness(0.5) blur(6px)" : "brightness(0.65)"}
                transition="filter 0.5s ease"
            />

            {/* Optional: Subtle Vignette to reinforce circular portal feel */}
            <Box
                position="absolute"
                inset="0"
                bg="radial-gradient(circle at center, transparent 30%, #06080F 90%)"
                opacity={0.6}
                pointerEvents="none"
            />

            {/* Canvas Layer */}
            <canvas
                ref={canvasRef}
                style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: "100%",
                    pointerEvents: "none" // Allow clicks to pass through
                }}
            />
        </Box>
    );
};
