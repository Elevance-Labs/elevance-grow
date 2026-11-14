import { Card, CardContent, Typography } from '@mui/material'
import { PageHeader } from '../components/common'

/** For people who can sign in but have nothing here yet (members, the agency). */
export default function Welcome() {
  return (
    <>
      <PageHeader title="Welcome to Grow" />
      <Card variant="outlined" sx={{ maxWidth: 640 }}>
        <CardContent>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>There is nothing for you here yet.</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 1 }}>
            Grow is where Elevance Labs finds and wins work. Its first part, prospecting, is for the growth team. The
            content calendar and product ideas come next, and will appear here when they do.
          </Typography>
        </CardContent>
      </Card>
    </>
  )
}
