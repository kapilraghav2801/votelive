import { BrowserRouter, Routes, Route } from 'react-router-dom';
import WakeUp from './components/WakeUp';
import Home from './pages/Home';
import CreatePoll from './pages/CreatePoll';
import Vote from './pages/Vote';
import GuessGameSetup from './guess-game/Setup';
import GuessGamePlay from './guess-game/Play';

export default function App() {
  return (
    <WakeUp>
      <BrowserRouter basename='/votelive'>
        <Routes>
          <Route path='/' element={<Home />} />
          <Route path='/create' element={<CreatePoll />} />
          <Route path='/vote/:roomKey' element={<Vote />} />
          <Route path='/guess-game' element={<GuessGameSetup />} />
          <Route path='/guess-game/:roomKey' element={<GuessGamePlay />} />
        </Routes>
      </BrowserRouter>
    </WakeUp>
  );
}
