// WaitingOrders and NewOrders on this PC (gradlew testReleaseUnitTest, or npm run test:android): reading both API
// answers, the signed-out and failure cases against a stand-in server (the JDK's own HttpServer), and telling new
// orders apart. With -PtestApi=http://127.0.0.1:4100 -PtestEmail=… -PtestPassword=… it also signs in to that
// running API (a local one with test data, never the live one) and checks /api/live/waiting there.
package com.bitevo.admin

import com.sun.net.httpserver.HttpServer
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.net.HttpURLConnection
import java.net.InetSocketAddress
import java.net.URL

class WaitingOrdersTest {
    private var server: HttpServer? = null
    private val cookie = "theme=dark; ${WaitingOrders.COOKIE}=abc123"

    // A stand-in API: each path answers with the given status and body; the Cookie header must carry the session.
    private fun serve(vararg routes: Triple<String, Int, String>): String {
        val s = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        for ((path, status, body) in routes) {
            s.createContext(path) { ex ->
                val signedIn = ex.requestHeaders.getFirst("Cookie")?.contains("${WaitingOrders.COOKIE}=abc123") == true
                val (code, text) = if (signedIn) status to body else 401 to """{"error":"Sign in."}"""
                val bytes = text.toByteArray()
                ex.sendResponseHeaders(code, bytes.size.toLong())
                ex.responseBody.use { it.write(bytes) }
            }
        }
        s.start()
        server = s
        return "http://127.0.0.1:${s.address.port}"
    }

    @After
    fun stop() { server?.stop(0) }

    private val waitingBody = """{"orders":[
        {"_id":"o2","orderNo":"BV1113-002","customerName":"Rahul Sharma","items":2,"total":318,"placedAt":"2026-11-13T10:05:00.000Z"},
        {"_id":"o1","orderNo":"BV1113-001","customerName":"","items":1,"total":99.5,"placedAt":"2026-11-13T10:00:00.000Z"}
    ],"at":"2026-11-13T10:06:00.000Z"}"""

    @Test
    fun readsTheWaitingList() {
        val list = WaitingOrders.fromWaiting(waitingBody)
        assertEquals(listOf("o2", "o1"), list.map { it.id })
        assertEquals("Rahul · 2 items · ₹318", list[0].summary)
        assertEquals("Customer · 1 item · ₹99.50", list[1].summary)
    }

    @Test
    fun readsTodaysOrdersKeepingOnlyThoseWaiting() {
        val body = """[
            {"_id":"a","orderNo":"BV-1","status":"preparing","customerName":"A","items":[{"qty":1}],"total":100,"placedAt":"2026-11-13T09:00:00Z"},
            {"_id":"b","orderNo":"BV-2","status":"placed","customerName":"Priya K","items":[{"qty":2},{"qty":1}],"total":250,"placedAt":"2026-11-13T09:10:00Z"},
            {"_id":"c","orderNo":"BV-3","status":"placed","customerName":"Amit","items":[{}],"total":80,"placedAt":"2026-11-13T09:20:00Z"}
        ]"""
        val list = WaitingOrders.fromOrderList(body)
        assertEquals(listOf("c", "b"), list.map { it.id }) // newest first, the preparing one left out
        assertEquals(3, list[1].items)
        assertEquals(1, list[0].items) // no qty counts as one
    }

    @Test
    fun asksTheApiWithTheSessionCookie() {
        val api = serve(Triple("/api/live/waiting", 200, waitingBody))
        val result = WaitingOrders.check(api, cookie)
        assertTrue(result is Check.Orders)
        assertEquals(2, (result as Check.Orders).orders.size)
    }

    @Test
    fun anOlderApiWithoutTheRouteFallsBackToTodaysOrders() {
        val api = serve(
            Triple("/api/live/waiting", 404, """{"error":"Not found."}"""),
            Triple("/api/orders", 200, """[{"_id":"x","orderNo":"BV-9","status":"placed","customerName":"Z","items":[],"total":10,"placedAt":"2026-11-13T09:00:00Z"}]"""),
        )
        val result = WaitingOrders.check(api, cookie) as Check.Orders
        assertEquals(listOf("x"), result.orders.map { it.id })
    }

    @Test
    fun noSessionOrAnEndedOneIsSignedOut() {
        val api = serve(Triple("/api/live/waiting", 200, waitingBody))
        assertEquals(Check.SignedOut, WaitingOrders.check(api, null))
        assertEquals(Check.SignedOut, WaitingOrders.check(api, "theme=dark"))
        assertEquals(Check.SignedOut, WaitingOrders.check(api, "${WaitingOrders.COOKIE}=expired")) // the API says 401
    }

    @Test
    fun serverTroubleIsAFailureToRetry() {
        val api = serve(Triple("/api/live/waiting", 502, "<html>Bad gateway</html>"))
        assertTrue(WaitingOrders.check(api, cookie) is Check.Failed)
        val garbled = serve(Triple("/api/live/waiting", 200, "<html>not json</html>"))
        assertTrue(WaitingOrders.check(garbled, cookie) is Check.Failed)
        stop()
        assertTrue(WaitingOrders.check("http://127.0.0.1:1", cookie, timeoutMs = 2000) is Check.Failed) // nothing listening
    }

    @Test
    fun onlyOrdersNotSeenBeforeAreNew() {
        val all = WaitingOrders.fromWaiting(waitingBody)
        val o1 = all.filter { it.id == "o1" }
        val tracker = NewOrders()
        assertEquals(emptyList<WaitingOrder>(), tracker.update(o1)) // first check: already waiting, not new
        assertEquals(listOf("o2"), tracker.update(all).map { it.id })
        assertEquals(emptyList<WaitingOrder>(), tracker.update(all))
        assertEquals(emptyList<WaitingOrder>(), tracker.update(o1)) // o2 accepted
        tracker.reset()
        assertEquals(emptyList<WaitingOrder>(), tracker.update(all)) // signed in again: a fresh start
    }

    // Against a running local API, when given one (never the live API: it signs in with the given test admin).
    @Test
    fun aRunningApiAnswersWithTheWaitingOrders() {
        val api = System.getProperty("bitevo.testApi").orEmpty().trimEnd('/')
        assumeTrue("no -PtestApi given", api.isNotEmpty())
        val conn = URL("$api/api/auth/login").openConnection() as HttpURLConnection
        conn.requestMethod = "POST"
        conn.doOutput = true
        conn.setRequestProperty("Content-Type", "application/json")
        val login = JSONObject().put("email", System.getProperty("bitevo.testEmail")).put("password", System.getProperty("bitevo.testPassword"))
        conn.outputStream.use { it.write(login.toString().toByteArray()) }
        assertEquals("sign-in", 200, conn.responseCode)
        val session = conn.headerFields["Set-Cookie"].orEmpty().first { it.startsWith("${WaitingOrders.COOKIE}=") }.substringBefore(';')
        val result = WaitingOrders.check(api, session)
        assertTrue("got $result", result is Check.Orders)
        println("Waiting on $api: ${(result as Check.Orders).orders.map { "${it.orderNo} (${it.summary})" }}")
        assertEquals(Check.SignedOut, WaitingOrders.check(api, "${WaitingOrders.COOKIE}=not-a-session"))
    }
}
