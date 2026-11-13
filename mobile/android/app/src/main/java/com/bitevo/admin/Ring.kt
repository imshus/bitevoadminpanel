// Plays the bell (RingSound) and buzzes, from the background service. It plays as an alarm, so it rings on the
// alarm volume, also with the phone on silent or vibrate, and isn't lowered by media volume. One ring at a time: a
// new one, or the app coming on screen, stops the one playing.
package com.bitevo.admin

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.Log

object Ring {
    private val main = Handler(Looper.getMainLooper())
    private val sounds = HashMap<String, ShortArray>() // made once per kind and style
    private var track: AudioTrack? = null
    private val attributes = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_ALARM)
        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
        .build()

    @Synchronized
    fun play(context: Context, kind: String, style: String, sound: Boolean) {
        if (sound) playSound(kind, style)
        vibrate(context, kind)
    }

    @Synchronized
    fun stop() {
        track?.let { runCatching { it.stop() }; it.release() }
        track = null
    }

    private fun playSound(kind: String, style: String) {
        stop()
        val pcm = sounds.getOrPut("$kind/$style") { RingSound.samples(kind, style) }
        try {
            val t = AudioTrack.Builder()
                .setAudioAttributes(attributes)
                .setAudioFormat(
                    AudioFormat.Builder()
                        .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                        .setSampleRate(RingSound.RATE)
                        .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                        .build(),
                )
                .setBufferSizeInBytes(pcm.size * 2)
                .setTransferMode(AudioTrack.MODE_STATIC)
                .build()
            t.write(pcm, 0, pcm.size)
            t.play()
            track = t
            val ms = pcm.size * 1000L / RingSound.RATE + 300
            main.postDelayed({ synchronized(this) { if (track === t) stop() } }, ms)
        } catch (e: Exception) {
            Log.w(TAG, "Couldn't play the bell: ${e.message}")
        }
    }

    private fun vibrate(context: Context, kind: String) {
        val pattern = if (kind == "remind") longArrayOf(0, 400, 200, 400) else longArrayOf(0, 600, 250, 600, 250, 600)
        try {
            val vibrator = if (Build.VERSION.SDK_INT >= 31) {
                (context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
            } else {
                @Suppress("DEPRECATION") context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
            }
            if (!vibrator.hasVibrator()) return
            if (Build.VERSION.SDK_INT >= 26) {
                @Suppress("DEPRECATION") // the AudioAttributes form works on every version and counts as an alarm
                vibrator.vibrate(VibrationEffect.createWaveform(pattern, -1), attributes)
            } else {
                @Suppress("DEPRECATION") vibrator.vibrate(pattern, -1, attributes)
            }
        } catch (e: Exception) {
            Log.w(TAG, "Couldn't vibrate: ${e.message}")
        }
    }
}
