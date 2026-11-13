// The bell's sounds (RingSound): how long they last, how loud they are, and that the loud ring is the buzzing
// "trrring" (on and off 25 times a second) with gaps between rings. Also writes them as WAV files under
// app/build/ring-*.wav, to listen to on the PC.
package com.bitevo.admin

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.abs
import kotlin.math.sqrt

class RingSoundTest {
    private fun peak(s: ShortArray, from: Int = 0, to: Int = s.size) = (from until to).maxOf { abs(s[it].toInt()) } / 32767.0
    private fun rms(s: ShortArray, from: Int, to: Int) = sqrt((from until to).sumOf { s[it].toDouble() * s[it] } / (to - from)) / 32767.0
    private fun at(seconds: Double) = (seconds * RingSound.RATE).toInt()

    @Test
    fun loudRingIsThreeHardRingsForANewOrderAndTwoAsAReminder() {
        val ring = RingSound.samples("new", "loud")
        assertEquals(1.25 * 2 + 0.95 + 0.05, RingSound.seconds("new", "loud"), 0.01)
        assertEquals(1.25 + 0.95 + 0.05, RingSound.seconds("remind", "loud"), 0.01)
        assertTrue("close to full scale", peak(ring) in 0.9..0.96)
        assertTrue("loud while ringing (RMS ${rms(ring, at(0.1), at(0.9))})", rms(ring, at(0.1), at(0.9)) > 0.3)
        assertTrue("silent between rings", peak(ring, at(0.97), at(1.24)) < 0.001)
        // The hammer: sound in the first half of each 1/25 s beat, silence in the second.
        assertTrue(peak(ring, at(0.2 + 0.002), at(0.2 + 0.018)) > 0.5)
        assertTrue(peak(ring, at(0.2 + 0.0205), at(0.2 + 0.0395)) < 0.001)
        assertTrue("the third ring", peak(ring, at(2.6), at(3.3)) > 0.5)
    }

    @Test
    fun softBellIsGentlerAndFades() {
        val bell = RingSound.samples("new", "soft")
        assertTrue(peak(bell) < 0.75)
        assertTrue("strikes", peak(bell, at(0.0), at(0.1)) > 0.3)
        assertTrue("fading at the end", peak(bell, bell.size - at(0.05), bell.size) < 0.05)
        assertTrue(RingSound.seconds("remind", "soft") < RingSound.seconds("new", "soft"))
    }

    @Test
    fun writesTheSoundsToListenTo() {
        for ((kind, style) in listOf("new" to "loud", "remind" to "loud", "new" to "soft")) {
            val pcm = RingSound.samples(kind, style)
            val file = File("build/ring-$kind-$style.wav")
            file.parentFile.mkdirs()
            file.writeBytes(wav(pcm))
            println("${file.absolutePath}: ${"%.2f".format(pcm.size.toDouble() / RingSound.RATE)} s, peak ${"%.2f".format(peak(pcm))}")
        }
    }

    private fun wav(pcm: ShortArray): ByteArray {
        val data = pcm.size * 2
        val b = ByteBuffer.allocate(44 + data).order(ByteOrder.LITTLE_ENDIAN)
        b.put("RIFF".toByteArray()).putInt(36 + data).put("WAVE".toByteArray())
        b.put("fmt ".toByteArray()).putInt(16).putShort(1).putShort(1).putInt(RingSound.RATE).putInt(RingSound.RATE * 2).putShort(2).putShort(16)
        b.put("data".toByteArray()).putInt(data)
        pcm.forEach { b.putShort(it) }
        return b.array()
    }
}
