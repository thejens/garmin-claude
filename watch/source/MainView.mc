import Toybox.Graphics;
import Toybox.Lang;
import Toybox.WatchUi;

class MainView extends WatchUi.View {

    function initialize() {
        View.initialize();
    }

    function onLayout(dc as Graphics.Dc) as Void {}

    function onUpdate(dc as Graphics.Dc) as Void {
        var w  = dc.getWidth();
        var h  = dc.getHeight();
        var cx = w / 2;

        // Background
        dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_BLACK);
        dc.clear();

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);

        var m = gMetrics;
        var active = ActivityService.isActive();

        // Row 1 — app name / status
        var statusStr = active ? "● RECORDING" : "CLAUDE CODE";
        dc.drawText(cx, h * 15 / 100,
            Graphics.FONT_TINY, statusStr, Graphics.TEXT_JUSTIFY_CENTER);

        // Row 2 — large tokens/sec (digit-only font OK here — it's numbers)
        var tpsStr = m.tokensPerSec.format("%.1f");
        dc.drawText(cx, h * 28 / 100,
            Graphics.FONT_NUMBER_HOT, tpsStr, Graphics.TEXT_JUSTIFY_CENTER);

        // Label under the number — use a letter font (FONT_NUMBER_* has no letters)
        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, h * 52 / 100,
            Graphics.FONT_TINY, "tok/s", Graphics.TEXT_JUSTIFY_CENTER);

        // Row 3 — tools/min
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        var tpmStr = m.toolsPerMin.format("%.1f") + " tools/min";
        dc.drawText(cx, h * 62 / 100,
            Graphics.FONT_SMALL, tpmStr, Graphics.TEXT_JUSTIFY_CENTER);

        // Row 4 — estimated server-side watts (tok/s × J/token for this model)
        var wStr = m.wattsEstimate.format("%.1f") + " W est.";
        dc.drawText(cx, h * 74 / 100,
            Graphics.FONT_SMALL, wStr, Graphics.TEXT_JUSTIFY_CENTER);

        // Row 5 — connection indicator
        var connStr = m.lastPollOk ? "● connected" : "○ waiting...";
        dc.setColor(m.lastPollOk ? Graphics.COLOR_GREEN : Graphics.COLOR_LT_GRAY,
                    Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, h * 85 / 100,
            Graphics.FONT_TINY, connStr, Graphics.TEXT_JUSTIFY_CENTER);
    }
}
