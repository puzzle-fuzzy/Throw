import { Route, Routes } from 'react-router';
import { HomePage } from './pages/HomePage';
import { RoomPage } from './pages/RoomPage';

export function App() {
  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col pt-4">
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/r/:code" element={<RoomPage />} />
      </Routes>
    </div>
  );
}
