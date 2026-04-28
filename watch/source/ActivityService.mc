import Toybox.Activity;
import Toybox.ActivityRecording;
import Toybox.FitContributor;
import Toybox.Lang;
import Toybox.WatchUi;

// Owns the ActivityRecording session and FitContributor fields.
// PollService calls recordSample() and addLap() on each poll cycle.
module ActivityService {

    var _active  as Boolean = false;
    var _session as ActivityRecording.Session?;

    // FIT Contributor RECORD fields — field IDs are frozen forever after first release.
    // Garmin Connect keys graphs by (developer_data_id, field_id); never repurpose an ID.
    var _fTokensPerSec as FitContributor.Field?;  // ID 0
    var _fToolsPerMin  as FitContributor.Field?;  // ID 1
    var _fCumTokens    as FitContributor.Field?;  // ID 2
    var _fWattsEst     as FitContributor.Field?;  // ID 7

    function isActive() as Boolean {
        return _active;
    }

    function toggle() as Void {
        if (_active) { stop(); } else { start(); }
    }

    function start() as Void {
        var sess = ActivityRecording.createSession({
            :name     => "Coding",
            :sport    => Activity.SPORT_GENERIC,
            :subSport => Activity.SUB_SPORT_GENERIC
        });
        _session = sess;

        // Create FIT contributor fields immediately after session creation.
        // Units appear on the graph Y-axis in Garmin Connect.
        _fTokensPerSec = sess.createField("tokens_per_sec", 0,
            FitContributor.DATA_TYPE_FLOAT,
            { :mesgType => FitContributor.MESG_TYPE_RECORD, :units => "tok/s" });
        _fToolsPerMin = sess.createField("tools_per_min", 1,
            FitContributor.DATA_TYPE_FLOAT,
            { :mesgType => FitContributor.MESG_TYPE_RECORD, :units => "tools/min" });
        _fCumTokens = sess.createField("cum_tokens", 2,
            FitContributor.DATA_TYPE_UINT32,
            { :mesgType => FitContributor.MESG_TYPE_RECORD, :units => "tokens" });
        _fWattsEst = sess.createField("watts_estimate", 7,
            FitContributor.DATA_TYPE_FLOAT,
            { :mesgType => FitContributor.MESG_TYPE_RECORD, :units => "W" });

        sess.start();
        _active = true;
        PollService.start();
        WatchUi.requestUpdate();
    }

    function stop() as Void {
        PollService.stop();
        if (_session != null) {
            var s = _session as ActivityRecording.Session;
            s.stop();
            s.save();
        }
        _session        = null;
        _fTokensPerSec  = null;
        _fToolsPerMin   = null;
        _fCumTokens     = null;
        _fWattsEst      = null;
        _active = false;
        WatchUi.requestUpdate();
    }

    // Called by PollService when lap: "new" appears — must run before recordSample().
    function addLap() as Void {
        if (_session != null) {
            (_session as ActivityRecording.Session).addLap();
        }
    }

    // Write the latest MetricsState values into the active FIT recording.
    // Called by PollService on every successful poll; no-op when not recording.
    function recordSample() as Void {
        if (!_active || _session == null) { return; }
        var m = gMetrics;
        if (_fTokensPerSec != null) {
            (_fTokensPerSec as FitContributor.Field).setData(m.tokensPerSec);
        }
        if (_fToolsPerMin != null) {
            (_fToolsPerMin as FitContributor.Field).setData(m.toolsPerMin);
        }
        if (_fCumTokens != null) {
            (_fCumTokens as FitContributor.Field).setData(m.cumTokens);
        }
        if (_fWattsEst != null) {
            (_fWattsEst as FitContributor.Field).setData(m.wattsEstimate);
        }
    }
}
