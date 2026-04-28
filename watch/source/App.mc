import Toybox.Application;
import Toybox.Lang;
import Toybox.WatchUi;

class App extends Application.AppBase {

    function initialize() {
        AppBase.initialize();
    }

    function onStart(state as Dictionary?) as Void {
        MetricsState.initialize();
        // PollService starts only when the user begins an activity (via ActivityService).
    }

    function onStop(state as Dictionary?) as Void {
        ActivityService.stop();
    }

    function getInitialView() as [Views] or [Views, InputDelegates] {
        return [new MainView(), new MainDelegate()] as [Views, InputDelegates];
    }
}
