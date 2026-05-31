import { Navigate } from 'react-router-dom';

export function PhotosHomePage() {
  return <Navigate to="/photos/all" replace />;
}
