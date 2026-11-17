/* ORBIT solar system background. Add data-solar to any positioned element.
   Optional: data-solar-cx, data-solar-cy (0-1), data-solar-alpha, data-solar-scale. */
(function () {
    "use strict";

    var PLANETS = [
        { n: "Mercury", r: 0.12, s: 2.2, c: "#b8b2a7" },
        { n: "Venus",   r: 0.19, s: 3.6, c: "#e8c27a" },
        { n: "Earth",   r: 0.27, s: 3.9, c: "#4f9dff", moon: true },
        { n: "Mars",    r: 0.35, s: 3.0, c: "#e0673f" },
        { n: "Jupiter", r: 0.50, s: 8.0, c: "#d9a066" },
        { n: "Saturn",  r: 0.66, s: 6.5, c: "#e6cf93", ring: true },
        { n: "Uranus",  r: 0.80, s: 4.8, c: "#8fe3e8" },
        { n: "Neptune", r: 0.94, s: 4.6, c: "#5b7cff" }
    ];

    var reduce = window.matchMedia &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

    function init(host) {
        var o = {
            cx: parseFloat(host.dataset.solarCx) || 0.5,
            cy: parseFloat(host.dataset.solarCy) || 0.5,
            alpha: parseFloat(host.dataset.solarAlpha) || 1,
            scale: parseFloat(host.dataset.solarScale) || 1
        };

        var cv = document.createElement("canvas");
        cv.className = "solar-canvas";
        cv.setAttribute("aria-hidden", "true");
        cv.style.cssText =
            "position:absolute;inset:0;width:100%;height:100%;z-index:0;pointer-events:none;";
        host.prepend(cv);

        var ctx = cv.getContext("2d");
        var W = 0, H = 0, stars = [];
        var m = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5, px: -9999, py: -9999 };
        var T = 0, last = 0, boost = 0;

        var angles = PLANETS.map(function (_, i) { return i * 1.1 + 0.5; });

        function resize() {
            var r = host.getBoundingClientRect();
            var dpr = Math.min(2, window.devicePixelRatio || 1);

            W = r.width; H = r.height;
            cv.width = Math.max(1, Math.round(W * dpr));
            cv.height = Math.max(1, Math.round(H * dpr));
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

            stars = [];
            for (var i = 0, n = Math.round(W * H / 5000); i < n; i++) {
                stars.push({
                    x: Math.random(), y: Math.random(), z: Math.random(),
                    r: Math.random() * 1.2 + 0.3, t: Math.random() * 6.28
                });
            }

            if (reduce) frame(0);
        }

        window.addEventListener("pointermove", function (e) {
            var r = host.getBoundingClientRect();

            m.px = e.clientX - r.left;
            m.py = e.clientY - r.top;
            m.tx = clamp(m.px / r.width, 0, 1);
            m.ty = clamp(m.py / r.height, 0, 1);
        });

        document.addEventListener("pointerleave", function () {
            m.px = m.py = -9999;
        });

        window.addEventListener("pointerdown", function () {
            if (m.px > -9000) boost = 6;
        });

        function frame(now) {
            var dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
            last = now;

            boost *= 0.96;
            T += dt * (1 + boost);

            m.x += (m.tx - m.x) * 0.06;
            m.y += (m.ty - m.y) * 0.06;

            ctx.clearRect(0, 0, W, H);
            ctx.globalAlpha = o.alpha;

            var sq = clamp(0.18 + 0.4 * H / W, 0.32, 0.62) + (m.y - 0.5) * 0.2;
            var rot = (m.x - 0.5) * 0.6;
            var R = Math.min(W * 0.5 / 0.94, H * 0.48 / (0.94 * sq)) * o.scale;
            var k = clamp(R / 520, 0.55, 1.4);
            var cx = W * o.cx - (m.x - 0.5) * 24;
            var cy = H * o.cy - (m.y - 0.5) * 16;

            // stars (parallax)
            stars.forEach(function (s) {
                var x = (s.x * W - (m.x - 0.5) * s.z * 40 + W) % W;
                var y = (s.y * H - (m.y - 0.5) * s.z * 26 + H) % H;

                ctx.globalAlpha = o.alpha * (0.3 + 0.5 * Math.abs(Math.sin(T * 0.8 + s.t)));
                ctx.fillStyle = s.z > 0.8 ? "#9af7bb" : "#ffffff";
                ctx.beginPath();
                ctx.arc(x, y, s.r * (0.6 + s.z * 0.6), 0, 6.283);
                ctx.fill();
            });

            ctx.globalAlpha = o.alpha;

            // orbit paths
            ctx.lineWidth = 1;
            PLANETS.forEach(function (p) {
                ctx.strokeStyle = "rgba(160,230,190,0.10)";
                ctx.beginPath();
                ctx.ellipse(cx, cy, R * p.r, R * p.r * sq, rot, 0, 6.283);
                ctx.stroke();
            });

            // planet positions
            var pts = PLANETS.map(function (p, i) {
                var a = angles[i] + T * 0.55 * Math.pow(0.12 / p.r, 1.5);
                var x = R * p.r * Math.cos(a);
                var y = R * p.r * Math.sin(a) * sq;

                return {
                    p: p, a: a,
                    x: cx + x * Math.cos(rot) - y * Math.sin(rot),
                    y: cy + x * Math.sin(rot) + y * Math.cos(rot),
                    back: Math.sin(a) < 0
                };
            });

            var hover = null, best = 1e9;

            pts.forEach(function (pt) {
                var d = Math.hypot(pt.x - m.px, pt.y - m.py);

                if (d < pt.p.s * k * 1.3 + 14 && d < best) { best = d; hover = pt; }
            });

            var sunNear = Math.hypot(cx - m.px, cy - m.py) < 60 * k;

            function drawPlanet(pt) {
                var p = pt.p;
                var hv = pt === hover;
                var r = p.s * k * (1 + 0.12 * Math.sin(pt.a)) * (hv ? 1.3 : 1);
                var dx = cx - pt.x, dy = cy - pt.y;
                var len = Math.hypot(dx, dy) || 1;
                var gx = pt.x + dx / len * r * 0.4;
                var gy = pt.y + dy / len * r * 0.4;

                ctx.save();
                ctx.shadowColor = p.c;
                ctx.shadowBlur = hv ? 24 : 8;
                ctx.fillStyle = p.c;
                ctx.beginPath();
                ctx.arc(pt.x, pt.y, r, 0, 6.283);
                ctx.fill();
                ctx.restore();

                var g = ctx.createRadialGradient(gx, gy, r * 0.2, pt.x, pt.y, r * 1.1);
                g.addColorStop(0, "rgba(255,255,255,0.35)");
                g.addColorStop(0.5, "rgba(0,0,0,0)");
                g.addColorStop(1, "rgba(0,0,0,0.7)");
                ctx.fillStyle = g;
                ctx.beginPath();
                ctx.arc(pt.x, pt.y, r, 0, 6.283);
                ctx.fill();

                if (p.ring) {
                    ctx.strokeStyle = "rgba(230,207,147,0.7)";
                    ctx.lineWidth = Math.max(1, r * 0.35);
                    ctx.beginPath();
                    ctx.ellipse(pt.x, pt.y, r * 2.1, r * 0.7, rot - 0.25, 0, 6.283);
                    ctx.stroke();
                }

                if (p.moon) {
                    var ma = T * 3;

                    ctx.fillStyle = "#dfe6e2";
                    ctx.beginPath();
                    ctx.arc(pt.x + Math.cos(ma) * r * 2.4,
                            pt.y + Math.sin(ma) * r * 2.4 * sq, 1.3 * k, 0, 6.283);
                    ctx.fill();
                }

                if (hv) {
                    ctx.strokeStyle = "rgba(154,247,187,0.8)";
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.arc(pt.x, pt.y, r + 6, 0, 6.283);
                    ctx.stroke();

                    ctx.font = "700 12px Manrope, system-ui, sans-serif";
                    ctx.fillStyle = "#eaf3ec";
                    ctx.textAlign = "center";
                    ctx.fillText(p.n, pt.x, pt.y - r - 12);
                }
            }

            pts.filter(function (pt) { return pt.back; }).forEach(drawPlanet);

            // sun
            var sr = 26 * k;
            var pulse = 1 + 0.05 * Math.sin(T * 2) + (sunNear ? 0.18 : 0);
            var corona = ctx.createRadialGradient(cx, cy, sr * 0.5, cx, cy, sr * 4.2 * pulse);

            corona.addColorStop(0, "rgba(255,180,84,0.55)");
            corona.addColorStop(0.35, "rgba(255,180,84,0.16)");
            corona.addColorStop(1, "rgba(255,180,84,0)");
            ctx.fillStyle = corona;
            ctx.beginPath();
            ctx.arc(cx, cy, sr * 4.2 * pulse, 0, 6.283);
            ctx.fill();

            var core = ctx.createRadialGradient(cx - sr * 0.3, cy - sr * 0.3, sr * 0.1, cx, cy, sr);

            core.addColorStop(0, "#ffffff");
            core.addColorStop(0.4, "#ffd08a");
            core.addColorStop(1, "#ffb454");
            ctx.fillStyle = core;
            ctx.beginPath();
            ctx.arc(cx, cy, sr * pulse, 0, 6.283);
            ctx.fill();

            pts.filter(function (pt) { return !pt.back; }).forEach(drawPlanet);

            ctx.globalAlpha = 1;
            ctx.textAlign = "start";
        }

        function loop(now) {
            frame(now);
            requestAnimationFrame(loop);
        }

        if (window.ResizeObserver) {
            new ResizeObserver(resize).observe(host);
        } else {
            window.addEventListener("resize", resize);
        }

        resize();

        if (!reduce) requestAnimationFrame(loop);
    }

    function start() {
        document.querySelectorAll("[data-solar]").forEach(init);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", start);
    } else {
        start();
    }
})();
