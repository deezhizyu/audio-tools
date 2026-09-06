import { LocationProvider, Route, Router } from 'preact-iso';
import { Header } from './components/Header';
import { AudioAlignmentPage } from './pages/AudioAlignmentPage';
import { RoomReverbPage } from './pages/RoomReverbPage';
import { SilenceRemoverPage } from './pages/SilenceRemoverPage';
import { BASE_PATH } from './utils/basePath';

export function App() {
  return (
    <LocationProvider>
      <div class="min-h-screen bg-surface-base">
        <Header />
        <Router>
          <Route path={`${BASE_PATH}/`} component={SilenceRemoverPage} />
          <Route path={`${BASE_PATH}/alignment`} component={AudioAlignmentPage} />
          <Route path={`${BASE_PATH}/room-reverb`} component={RoomReverbPage} />
        </Router>
      </div>
    </LocationProvider>
  );
}
