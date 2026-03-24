import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import { ArenaProvider } from "@/context/ArenaContext";
import Landing from "@/pages/Landing";
import Lobby from "@/pages/Lobby";
import MintProfile from "@/pages/MintProfile";
import NotFound from "@/pages/NotFound";
import RoomLobby from "@/pages/RoomLobby";

const queryClient = new QueryClient();

const LegacyRoomRedirect = () => <Navigate to="/lobby" replace />;

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <ArenaProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/mint" element={<MintProfile />} />
            <Route path="/lobby" element={<Lobby />} />
            <Route path="/room/:mode/:roomId" element={<RoomLobby />} />
            <Route path="/room/:roomId" element={<LegacyRoomRedirect />} />
            <Route path="/game/:roomId/:mode" element={<LegacyRoomRedirect />} />
            <Route path="/verdict/:roomId" element={<LegacyRoomRedirect />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </ArenaProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
