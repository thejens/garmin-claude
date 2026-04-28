import Toybox.Communications;
import Toybox.Lang;
import Toybox.Time;
import Toybox.Timer;
import Toybox.WatchUi;

// Polls the daemon every POLL_INTERVAL_MS.
// On a successful response, updates MetricsState (for display) and
// ActivityService (writes FIT samples and handles lap markers).
module PollService {

    var _timer      as Timer.Timer?;
    var _requesting as Boolean = false; // guard against stacking concurrent requests
    var _backoffSec as Number  = 0;
    var _skipUntil  as Number  = 0;     // unix seconds; skip ticks until this passes

    function start() as Void {
        _timer = new Timer.Timer();
        (_timer as Timer.Timer).start(
            new Lang.Method(PollService, :onTick),
            Config.POLL_INTERVAL_MS,
            true
        );
    }

    function stop() as Void {
        if (_timer != null) {
            (_timer as Timer.Timer).stop();
            _timer = null;
        }
        _requesting = false;
    }

    function onTick() as Void {
        if (_requesting) { return; }                         // previous request still in flight
        if (Time.now().value() < _skipUntil) { return; }    // in backoff window

        _requesting = true;

        var options = {
            :method      => Communications.HTTP_REQUEST_METHOD_GET,
            :headers     => {
                "Authorization" => "Bearer " + Config.BEARER_KEY,
                "User-Agent"    => "claude-code-tracker/" + Config.VERSION
            },
            :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
        };

        var url = Config.DAEMON_URL + "/poll?cursor=" + gMetrics.cursor;
        Communications.makeWebRequest(
            url, null, options,
            new Lang.Method(PollService, :onResponse)
        );
    }

    function onResponse(responseCode as Number, data as Dictionary?) as Void {
        _requesting = false;

        if (responseCode == 200 && data != null) {
            _backoffSec = 0;
            _skipUntil  = 0;

            // Process every sample so laps and running metrics are all applied in order
            var samples = data["samples"];
            if (samples instanceof Array) {
                var arr = samples as Array;
                for (var i = 0; i < arr.size(); i++) {
                    var raw = arr[i];
                    if (!(raw instanceof Dictionary)) { continue; }
                    var s = raw as Dictionary;

                    // Lap marker comes first — session.addLap() must precede the sample write
                    var lap = s["lap"];
                    if (lap instanceof String && (lap as String).equals("new")) {
                        ActivityService.addLap();
                    }

                    MetricsState.applyLatest(s);
                    ActivityService.recordSample();
                }
            }

            // Advance the cursor so the next poll only fetches new samples
            var cur = data["cursor"];
            var sid = data["session_id"];
            if (cur instanceof Number) {
                MetricsState.saveCursor(
                    cur as Number,
                    (sid instanceof String) ? sid as String : gMetrics.sessionId
                );
            }

        } else if (responseCode >= 400 && responseCode < 500) {
            // Auth failure or bad request — long pause before retrying
            gMetrics.lastPollOk = false;
            _backoffSec = 30;
            _skipUntil  = Time.now().value() + _backoffSec;

        } else {
            // Network error, server error, or timeout — exponential backoff up to 30 s
            gMetrics.lastPollOk = false;
            _backoffSec = (_backoffSec < 2 ? 2 : (_backoffSec * 2 < 30 ? _backoffSec * 2 : 30));
            _skipUntil  = Time.now().value() + _backoffSec;
        }

        WatchUi.requestUpdate();
    }
}
