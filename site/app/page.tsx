import Nav from '@/components/Nav'
import Hero from '@/components/Hero'
import ThreeWays from '@/components/ThreeWays'
import HowItWorks from '@/components/HowItWorks'
import TrustStrip from '@/components/TrustStrip'
import Outputs from '@/components/Outputs'
import Comparison from '@/components/Comparison'
import Verticals from '@/components/Verticals'
import Process from '@/components/Process'
import BlogSection from '@/components/BlogSection'
import AboutSection from '@/components/AboutSection'
import CtaBand from '@/components/CtaBand'
import Footer from '@/components/Footer'

export default function HomePage() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <ThreeWays />
        <HowItWorks />
        <TrustStrip />
        <Outputs />
        <Comparison />
        <Verticals />
        <Process />
        <BlogSection />
        <AboutSection />
        <CtaBand />
      </main>
      <Footer />
    </>
  )
}
