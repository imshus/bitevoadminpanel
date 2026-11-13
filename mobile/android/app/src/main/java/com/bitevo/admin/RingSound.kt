// The bell's two sounds as samples, made here rather than shipped as a file, and the same as the panel's own bell
// (frontend/src/lib/orderAlerts.js) so the app sounds the same open or closed:
//   "loud" (the default): a hard, buzzy "trrring", a bright chord switched on and off 25 times a second, rung three
//          times for a new order and twice as a reminder, pushed close to full scale;
//   "soft": a "ding-dong" bell, four strikes for a new order, two as a reminder.
// No Android classes here, so JVM tests can check it (RingSoundTest). Ring.kt plays it.
package com.bitevo.admin

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.ln
import kotlin.math.sin
import kotlin.math.sqrt
import kotlin.math.tanh

object RingSound {
    const val RATE = 44_100

    private const val RING_S = 0.95      // one "trrring"
    private const val RING_EVERY_S = 1.25
    private const val STRIKE_EVERY_S = 0.42

    // kind: "new" or "remind" (anything else counts as "new"); style: "soft", or "loud" for anything else.
    fun samples(kind: String, style: String): ShortArray =
        if (style == "soft") soft(if (kind == "remind") 2 else 4) else loud(if (kind == "remind") 2 else 3)

    fun seconds(kind: String, style: String) = samples(kind, style).size.toDouble() / RATE

    private fun loud(rings: Int): ShortArray {
        val total = ((rings - 1) * RING_EVERY_S + RING_S + 0.05) * RATE
        val out = DoubleArray(total.toInt())
        // A square wave and a triangle made of their odd harmonics up to what the sample rate can carry, so they
        // stay clean (no aliasing whistle), like the browser's oscillators.
        val tones = listOf(Triple('s', 1318.5, 0.5), Triple('s', 1661.2, 0.35), Triple('t', 2637.0, 0.3))
        val partials = tones.flatMap { (shape, freq, amp) ->
            generateSequence(1) { it + 2 }.takeWhile { it * freq < RATE / 2.0 - 500 }.map { n ->
                val a = if (shape == 's') 4 / PI / n else 8 / (PI * PI) / (n * n) * (if ((n / 2) % 2 == 0) 1 else -1)
                Pair(freq * n, a * amp)
            }.toList()
        }
        val len = (RING_S * RATE).toInt()
        for (r in 0 until rings) {
            val start = (r * RING_EVERY_S * RATE).toInt()
            for (i in 0 until len) {
                val t = i.toDouble() / RATE
                val env = when {
                    t < 0.01 -> t / 0.01
                    t > RING_S - 0.04 -> ((RING_S - t) / 0.04).coerceAtLeast(0.0)
                    else -> 1.0
                }
                if ((t * 25) % 1.0 >= 0.5) continue // the hammer is off for half of each 25 Hz beat
                var v = 0.0
                for ((f, a) in partials) v += a * sin(2 * PI * f * t)
                out[start + i] += v * env
            }
        }
        return toPcm(out, drive = 2.2, peak = 0.95)
    }

    private fun soft(strikes: Int): ShortArray {
        val partials = listOf(1.0 to 1.0, 2.0 to 0.5, 2.76 to 0.32, 5.4 to 0.14)
        val longest = 1.7
        val total = ((strikes - 1) * STRIKE_EVERY_S + longest + 0.05) * RATE
        val out = DoubleArray(total.toInt())
        for (s in 0 until strikes) {
            val start = (s * STRIKE_EVERY_S * RATE).toInt()
            val freq = if (s % 2 == 1) 784.0 else 1046.5
            for ((ratio, amp) in partials) {
                val fade = longest / sqrt(ratio)
                val n = (fade * RATE).toInt()
                val decay = ln(amp / 0.0001) / (fade - 0.006) // from amp down to 0.0001 by `fade`
                for (i in 0 until n) {
                    val idx = start + i
                    if (idx >= out.size) break
                    val t = i.toDouble() / RATE
                    val env = if (t < 0.006) amp * (t / 0.006) else amp * exp(-decay * (t - 0.006))
                    out[idx] += env * sin(2 * PI * freq * ratio * t)
                }
            }
        }
        return toPcm(out, drive = 1.0, peak = 0.7)
    }

    // To 16-bit samples: scaled to the loudest point, then through a soft limiter (tanh), which keeps it from
    // crackling and makes the loud ring denser, as the browser's limiter does.
    private fun toPcm(x: DoubleArray, drive: Double, peak: Double): ShortArray {
        val max = x.maxOf { abs(it) }.takeIf { it > 0 } ?: 1.0
        val norm = tanh(drive)
        return ShortArray(x.size) { i -> (tanh(drive * x[i] / max) / norm * peak * Short.MAX_VALUE).toInt().toShort() }
    }
}
