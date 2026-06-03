import { redirect } from 'next/navigation'

/** Root route → redirect to projects */
export default function Home() {
  redirect('/projects')
}
