import Toybox.Application;
import Toybox.Lang;

// Live metrics updated by PollService on each successful poll response.
// Values default to zero/empty and are rendered even before the first poll.
class MetricsData {
    var tokensPerSec  as Float  = 0.0f;
    var toolsPerMin   as Float  = 0.0f;
    var cumTokens     as Number = 0;
    var linesAdded    as Number = 0;
    var linesRemoved  as Number = 0;
    var fileHash      as Number = 0;
    var modelId       as Number = 0;
    var wattsEstimate as Float  = 0.0f;
    var cursor        as Number = 0;
    var sessionId     as String = "";
    var lastPollOk    as Boolean = false;
}

// Global singleton — module-level var accessible from any file.
var gMetrics as MetricsData = new MetricsData();

module MetricsState {

    // Called once at app start — restores cursor so we don't re-process old events.
    function initialize() as Void {
        var saved = Application.Storage.getValue("cursor");
        if (saved instanceof Number) { gMetrics.cursor = saved; }
        var sid = Application.Storage.getValue("session_id");
        if (sid instanceof String) { gMetrics.sessionId = sid; }
    }

    // Apply a single sample dictionary from the /poll response.
    function applyLatest(sample as Dictionary) as Void {
        var tps = sample["tokens_per_sec"];
        if (tps instanceof Float)  { gMetrics.tokensPerSec = tps; }
        var tpm = sample["tools_per_min"];
        if (tpm instanceof Float)  { gMetrics.toolsPerMin = tpm; }
        else if (tpm instanceof Number) { gMetrics.toolsPerMin = (tpm as Number).toFloat(); }
        var ct  = sample["cum_tokens"];
        if (ct  instanceof Number) { gMetrics.cumTokens = ct; }
        var la  = sample["lines_added"];
        if (la  instanceof Number) { gMetrics.linesAdded = la; }
        var lr  = sample["lines_removed"];
        if (lr  instanceof Number) { gMetrics.linesRemoved = lr; }
        var fh  = sample["current_file_hash"];
        if (fh  instanceof Number) { gMetrics.fileHash = fh; }
        var mid = sample["model_id"];
        if (mid instanceof Number) { gMetrics.modelId = mid; }
        var we  = sample["watts_estimate"];
        if (we  instanceof Float)  { gMetrics.wattsEstimate = we; }
        gMetrics.lastPollOk = true;
    }

    // Persist cursor and session ID so a restarted app can resume without gaps.
    function saveCursor(cursor as Number, sessionId as String) as Void {
        gMetrics.cursor = cursor;
        gMetrics.sessionId = sessionId;
        Application.Storage.setValue("cursor", cursor);
        Application.Storage.setValue("session_id", sessionId);
    }
}
