// Asking the admin API which orders are waiting to be accepted, as the signed-in admin, and telling which of them
// are new. No Android classes here (plain java.net and org.json), so it runs in JVM tests too (WaitingOrdersTest).
package com.bitevo.admin

import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

data class WaitingOrder(
    val id: String,
    val orderNo: String,
    val customerName: String,
    val items: Int,
    val total: Double,
    val placedAt: String,
) {
    val firstName get() = customerName.trim().split(Regex("\\s+")).firstOrNull()?.takeIf { it.isNotEmpty() } ?: "Customer"

    // "Rahul · 2 items · ₹318", as the panel's bell says it.
    val summary get() = "$firstName · $items item${if (items == 1) "" else "s"} · ₹${money(total)}"
}

private fun money(n: Double) = if (n % 1.0 == 0.0) n.toLong().toString() else String.format(java.util.Locale.US, "%.2f", n)

sealed class Check {
    data class Orders(val orders: List<WaitingOrder>) : Check()
    object SignedOut : Check()                          // no session, or it ended (401): sign in again in the app
    data class Failed(val reason: String) : Check()     // offline, the server down…: try again later
}

object WaitingOrders {
    const val COOKIE = "bitevo_admin_session"

    /**
     * GET {appUrl}/api/live/waiting with the admin's session cookie (the whole Cookie header the WebView has for
     * the panel). An API from before that route answers 404: then today's orders (/api/orders?days=1), the
     * placed ones.
     */
    fun check(appUrl: String, cookies: String?, timeoutMs: Int = 10_000): Check {
        if (cookies.isNullOrBlank() || !cookies.contains("$COOKIE=")) return Check.SignedOut
        return try {
            val (status, body) = get("$appUrl/api/live/waiting", cookies, timeoutMs)
            when {
                status == 401 -> Check.SignedOut
                status == 404 -> {
                    val (s2, b2) = get("$appUrl/api/orders?days=1", cookies, timeoutMs)
                    when (s2) {
                        401 -> Check.SignedOut
                        200 -> Check.Orders(fromOrderList(b2))
                        else -> Check.Failed("HTTP $s2")
                    }
                }
                status == 200 -> Check.Orders(fromWaiting(body))
                else -> Check.Failed("HTTP $status")
            }
        } catch (e: IOException) {
            Check.Failed(e.message ?: e.javaClass.simpleName)
        } catch (e: org.json.JSONException) {
            Check.Failed("Unexpected answer: ${e.message}")
        }
    }

    // { orders: [{ _id, orderNo, customerName, items, total, placedAt }] } from /api/live/waiting.
    fun fromWaiting(body: String): List<WaitingOrder> {
        val list = JSONObject(body).optJSONArray("orders") ?: JSONArray()
        return (0 until list.length()).map { i ->
            val o = list.getJSONObject(i)
            WaitingOrder(
                id = o.getString("_id"),
                orderNo = o.optString("orderNo"),
                customerName = o.optString("customerName"),
                items = o.optInt("items", 0),
                total = o.optDouble("total", 0.0),
                placedAt = o.optString("placedAt"),
            )
        }
    }

    // The full orders from /api/orders?days=1: the ones still waiting to be accepted, newest first.
    fun fromOrderList(body: String): List<WaitingOrder> {
        val list = JSONArray(body)
        return (0 until list.length()).map { list.getJSONObject(it) }
            .filter { it.optString("status") == "placed" }
            .map { o ->
                val items = o.optJSONArray("items") ?: JSONArray()
                WaitingOrder(
                    id = o.getString("_id"),
                    orderNo = o.optString("orderNo"),
                    customerName = o.optString("customerName"),
                    items = (0 until items.length()).sumOf { items.getJSONObject(it).optInt("qty", 1) },
                    total = o.optDouble("total", 0.0),
                    placedAt = o.optString("placedAt"),
                )
            }
            .sortedByDescending { it.placedAt }
    }

    private fun get(url: String, cookies: String, timeoutMs: Int): Pair<Int, String> {
        val conn = URL(url).openConnection() as HttpURLConnection
        try {
            conn.connectTimeout = timeoutMs
            conn.readTimeout = timeoutMs
            conn.useCaches = false
            conn.instanceFollowRedirects = false
            conn.setRequestProperty("Cookie", cookies)
            conn.setRequestProperty("Accept", "application/json")
            conn.setRequestProperty("User-Agent", "BiteVoAdmin-Android")
            val status = conn.responseCode
            val stream = if (status in 200..299) conn.inputStream else conn.errorStream
            val body = stream?.bufferedReader()?.use { it.readText() } ?: ""
            return status to body
        } finally {
            conn.disconnect()
        }
    }
}

/**
 * Which waiting orders are new since the last check. The first check counts none as new (they were already
 * waiting when watching began; the reminder rings for them), like the panel's own bell on its first load.
 */
class NewOrders {
    private var seen: MutableSet<String>? = null

    fun update(orders: List<WaitingOrder>): List<WaitingOrder> {
        val known = seen
        val ids = orders.map { it.id }
        if (known == null) {
            seen = ids.toMutableSet()
            return emptyList()
        }
        val fresh = orders.filter { it.id !in known }
        known += ids
        if (known.size > 5000) { known.clear(); known += ids } // a long-running service: forget old ones
        return fresh
    }

    fun reset() { seen = null }
}
