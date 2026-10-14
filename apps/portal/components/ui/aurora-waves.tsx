"use client"

/**
 * AuroraWaves — fundo ambiente WebGL (OGL) para a seção de produtos.
 *
 * Onda dourada низкой amplitude sobre o `--bg-0` do tema (nunca azul/magenta,
 * nunca preto/branco puro). Motor próprio, sem providers externos:
 * - pausa fora da viewport (IntersectionObserver) e com aba oculta;
 * - sem contexto GL sob `prefers-reduced-motion` (cai no fallback estático);
 * - uniformes atualizados sem recriar o programa;
 * - contexto liberado no unmount (StrictMode-safe).
 *
 * Detalhe crítico: o canvas GL é criado imperativamente dentro do efeito
 * (replaceWith no placeholder do SSR) — nunca reutilizamos o nó JSX para
 * contexto, porque `getContext` no mesmo canvas devolve o MESMO contexto
 * (morto após `loseContext` no cleanup do StrictMode/dev).
 */

import { useEffect, useRef } from "react"
import { Renderer, Program, Mesh, Triangle, Vec2 } from "ogl"

const vertex = /* glsl */ `
attribute vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`

const fragment = /* glsl */ `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2 uResolution;
uniform float uTime;
uniform float uSpeed;
uniform float uGlow;
uniform float uTheme; // 0 = dark, 1 = light

/* Tokens AurumBit (globals.css): ouro idêntico nos 2 temas,
   bg = --bg-0 de cada tema. */
const vec3 BG_DARK  = vec3(0.035, 0.031, 0.024);
const vec3 BG_LIGHT = vec3(0.969, 0.957, 0.929);
const vec3 G700  = vec3(0.459, 0.365, 0.180);
const vec3 G500  = vec3(0.753, 0.627, 0.376);
const vec3 G300  = vec3(0.847, 0.722, 0.475);
const vec3 G200  = vec3(0.918, 0.855, 0.714);
const vec3 GDEEP = vec3(0.420, 0.325, 0.125);

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

/* dark: bronze profundo -> ouro -> ponta clara.
   light: ancorado no ouro escuro (nunca G200/G300 puro). */
vec3 aurumDark(float t) {
  vec3 c = mix(G700 * 0.55, G500, smoothstep(0.0, 0.55, t));
  c = mix(c, G200, smoothstep(0.55, 1.0, t) * 0.85);
  return c;
}
vec3 aurumLight(float t) {
  vec3 c = mix(GDEEP * 0.85, G700, smoothstep(0.0, 0.6, t));
  c = mix(c, G500, smoothstep(0.6, 1.0, t) * 0.55);
  return c;
}

void main() {
  vec2 uv = (gl_FragCoord.xy / uResolution) * 2.0 - 1.0;
  uv.x *= uResolution.x / uResolution.y;

  float t = uTime * uSpeed;
  /* 3 senos discretos: linha fina, cauda curta, sem pressa */
  float w = sin(uv.x * 1.8 + t) * 0.20
          + sin(uv.x * 3.1 + t * 1.3 + 1.7) * 0.12
          + sin(uv.x * 5.3 - t * 0.7 + 4.1) * 0.07;

  float d = abs(uv.y * 0.9 - w);
  float line = exp(-d * d * 22.0);
  float halo = exp(-d * d * 5.0) * 0.35;
  float a = (line + halo) * uGlow;

  /* topo/base calmos: o H1 nunca cruza pico de brilho */
  float mask = smoothstep(1.15, 0.25, abs(uv.y));

  float tt = clamp(w * 1.4 + uv.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 wave = mix(aurumDark(tt), aurumLight(tt), uTheme);
  vec3 bg = mix(BG_DARK, BG_LIGHT, uTheme);

  vec3 col = mix(bg, wave, clamp(a * mask, 0.0, 1.0));
  /* dither anti-banding (gradiente ouro de baixa amplitude em 8-bit) */
  col += (hash(gl_FragCoord.xy) - 0.5) * (1.5 / 255.0);

  gl_FragColor = vec4(col, 1.0);
}
`

export interface AuroraWavesProps {
  /** 0.15 – 0.3: mesma família temporal dos orbes do portal (16–26s). */
  speed?: number
  /** Intensidade da onda (o wrapper afina por tema/transparência). */
  glow?: number
  theme?: "dark" | "light"
  /** ≤ 0.75: render em meia-resolução + upscale bilinear (fill-rate). */
  resolutionScale?: number
  className?: string
}

type LiveCanvas = HTMLCanvasElement & { __applyAurora?: () => void }

export default function AuroraWaves({
  speed = 0.22,
  glow = 1.0,
  theme = "dark",
  resolutionScale = 0.75,
  className,
}: AuroraWavesProps) {
  const ref = useRef<HTMLCanvasElement>(null)
  const liveRef = useRef<HTMLCanvasElement | null>(null)
  const clsRef = useRef(className ?? "prod-aurora-canvas")
  clsRef.current = className ?? "prod-aurora-canvas"
  const optsRef = useRef({ speed, glow, theme, resolutionScale })
  optsRef.current = { speed, glow, theme, resolutionScale }

  useEffect(() => {
    const placeholder = ref.current
    if (!placeholder || !placeholder.parentElement) return

    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    // Sem GL sob reduced-motion: o canvas fica transparente e o fallback
    // estático da seção assume (economia de bateria + coerência).
    if (mq.matches) return

    // Canvas próprio por montagem: getContext no mesmo nó devolveria um
    // contexto morto após o loseContext do cleanup (StrictMode/dev).
    const canvas = document.createElement("canvas")
    canvas.className = clsRef.current
    canvas.setAttribute("aria-hidden", "true")
    canvas.tabIndex = -1
    placeholder.replaceWith(canvas)
    liveRef.current = canvas

    const parent = canvas.parentElement as HTMLElement | null
    if (!parent) return

    let renderer: Renderer | null = null
    let program: Program | null = null
    let raf = 0
    let running = false
    let visible = true
    let time = Math.random() * 100
    let last = 0
    let disposed = false
    let firstFrame = true

    try {
      renderer = new Renderer({
        canvas,
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        dpr: Math.min(window.devicePixelRatio || 1, 1.5),
        powerPreference: "low-power",
      })
    } catch {
      restore()
      return
    }
    const gl = renderer.gl

    const onLost = (e: Event) => {
      e.preventDefault()
      stop()
    }
    canvas.addEventListener("webglcontextlost", onLost, false)

    function restore() {
      liveRef.current = null
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      if (canvas.parentElement) canvas.replaceWith(placeholder!)
    }

    function stop() {
      running = false
      cancelAnimationFrame(raf)
    }

    try {
      const geometry = new Triangle(gl)
      program = new Program(gl, {
        vertex,
        fragment,
        uniforms: {
          uTime: { value: 0 },
          uResolution: { value: new Vec2(1, 1) },
          uSpeed: { value: optsRef.current.speed },
          uGlow: { value: optsRef.current.glow },
          uTheme: { value: optsRef.current.theme === "light" ? 1.0 : 0.0 },
        },
      })
      const mesh = new Mesh(gl, { geometry, program })

      const resize = () => {
        if (disposed || !renderer || !program) return
        const w = Math.max(1, parent.clientWidth)
        const h = Math.max(1, parent.clientHeight)
        const rs = Math.min(Math.max(optsRef.current.resolutionScale, 0.25), 1)
        renderer.setSize(w * rs, h * rs)
        // setSize fixa style em px: devolve ao CSS (upscale bilinear).
        gl.canvas.style.width = "100%"
        gl.canvas.style.height = "100%"
        // gl_FragCoord vive no drawing buffer: aspect sempre correto.
        program.uniforms.uResolution.value.set(gl.canvas.width, gl.canvas.height)
      }

      const frame = (now: number) => {
        if (!running) return
        raf = requestAnimationFrame(frame)
        if (!visible || document.hidden || !renderer || !program) return
        const dt = Math.min((now - last) / 1000 || 0.016, 0.05)
        last = now
        time = (time + dt) % 3600
        program.uniforms.uTime.value = time
        renderer.render({ scene: mesh })
        if (firstFrame) {
          firstFrame = false
          // prova de vida para diagnóstico (DevTools → Elements).
          canvas.dataset.aurora = "on"
        }
      }

      const start = () => {
        if (running || disposed) return
        running = true
        last = performance.now()
        resize()
        raf = requestAnimationFrame(frame)
      }

      const ro = new ResizeObserver(resize)
      ro.observe(parent)
      const io = new IntersectionObserver(
        ([entry]) => {
          visible = entry.isIntersecting
          if (visible && !document.hidden) start()
          else stop()
        },
        { threshold: 0, rootMargin: "200px" }
      )
      io.observe(canvas)
      const onVis = () => {
        if (document.hidden) stop()
        else if (visible) start()
      }
      document.addEventListener("visibilitychange", onVis)
      ;(canvas as LiveCanvas).__applyAurora = () => {
        if (!program || disposed) return
        program.uniforms.uSpeed.value = optsRef.current.speed
        program.uniforms.uGlow.value = optsRef.current.glow
        program.uniforms.uTheme.value = optsRef.current.theme === "light" ? 1.0 : 0.0
      }

      start()
      return () => {
        disposed = true
        stop()
        ro.disconnect()
        io.disconnect()
        document.removeEventListener("visibilitychange", onVis)
        canvas.removeEventListener("webglcontextlost", onLost)
        delete (canvas as LiveCanvas).__applyAurora
        gl.getExtension("WEBGL_lose_context")?.loseContext()
        restore()
      }
    } catch {
      try {
        gl.getExtension("WEBGL_lose_context")?.loseContext()
      } catch {
        /* noop */
      }
      restore()
    }
    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      canvas.removeEventListener("webglcontextlost", onLost)
      restore()
    }
    // monta 1x (StrictMode-safe via cleanup); props via refs + efeito abaixo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Atualiza uniformes + classe sem recriar Renderer/Program.
  useEffect(() => {
    const live = liveRef.current as LiveCanvas | null
    if (live) {
      if (className) live.className = className
      live.__applyAurora?.()
    }
  })

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      tabIndex={-1}
      className={className ?? "prod-aurora-canvas"}
    />
  )
}
