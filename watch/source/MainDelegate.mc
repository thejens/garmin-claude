import Toybox.Lang;
import Toybox.WatchUi;

class MainDelegate extends WatchUi.BehaviorDelegate {

    function initialize() {
        BehaviorDelegate.initialize();
    }

    // START/STOP button — toggles the coding session.
    function onSelect() as Boolean {
        ActivityService.toggle();
        return true;
    }

    // BACK button — stop if active, otherwise let the system handle it.
    function onBack() as Boolean {
        if (ActivityService.isActive()) {
            ActivityService.stop();
            return true;
        }
        return false;
    }

    // MENU button — placeholder for a settings/lap menu (step 9+).
    function onMenu() as Boolean {
        return true;
    }
}
