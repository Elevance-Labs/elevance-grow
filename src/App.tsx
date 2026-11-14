import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './auth/AuthProvider'
import Layout from './components/Layout'
import { Splash } from './components/common'
import Login from './pages/Login'
import Today from './pages/Today'
import Markets from './pages/Markets'
import Market from './pages/Market'
import Account from './pages/Account'
import Pipeline from './pages/Pipeline'
import Playbook from './pages/Playbook'
import Sources from './pages/Sources'
import Runs from './pages/Runs'
import Settings from './pages/Settings'
import Welcome from './pages/Welcome'

export default function App() {
  const { loading, profile, isAdmin, isGrowth } = useAuth()

  if (loading) return <Splash />
  if (!profile) return <Login />

  // Gating is by not registering a route; the database refuses the same people.
  const home = isGrowth ? '/today' : '/welcome'
  return (
    <Routes>
      <Route element={<Layout />}>
        {isGrowth ? (
          <>
            <Route path="/today" element={<Today />} />
            <Route path="/markets" element={<Markets />} />
            <Route path="/markets/:id" element={<Market />} />
            <Route path="/accounts/:id" element={<Account />} />
            <Route path="/pipeline" element={<Pipeline />} />
            <Route path="/playbook" element={<Playbook />} />
            <Route path="/sources" element={<Sources />} />
            <Route path="/runs" element={<Runs />} />
          </>
        ) : (
          <Route path="/welcome" element={<Welcome />} />
        )}
        {isAdmin && <Route path="/settings" element={<Settings />} />}
        <Route path="*" element={<Navigate to={home} replace />} />
      </Route>
    </Routes>
  )
}
