import { Suspense,React,lazy} from 'react'
import './App.css'
import Loading from './Loading/Loading';
const HomePage=lazy(() =>
  new Promise(resolve => {
    setTimeout(() => {
      resolve(import('./Main/HomePage.jsx')); 
    }, 3000);
  })) 
function App() {
  
  return (
  <div className='w-[300px] min-h-[400px] bg-blue-200  text-center '>
    <Suspense fallback={<Loading/>}>
      <HomePage/>
    </Suspense>
  </div>
  )
}

export default App
