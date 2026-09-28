'use client'

import Footer from '@/components/footer'
import NavigationMenuDemo from '@/components/navigation-menu'
import PageHeader from '@/components/page-header'

export default function TermsOfServicePage() {
  return (
    <div className="flex min-h-screen flex-col">
      <NavigationMenuDemo />
      <PageHeader
        title="Terms of Service"
        description="Please read these terms carefully before using our services or website."
        backgroundImage="/bg03.jpg"
      />
      <section className="bg-white px-4 py-20">
        <div className="container mx-auto max-w-4xl">
          <div className="prose prose-lg max-w-none">
            <div className="mb-8">
              <p className="text-sm text-gray-600 mb-4">
                <strong>Last Updated:</strong>{' '}
                {new Date().toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </p>
              <p className="text-lg text-gray-700 leading-relaxed">
                Welcome to Denel Dental Clinic. These Terms of Service ("Terms") govern your access
                to and use of our website and dental services. By accessing our website or using our
                services, you agree to be bound by these Terms. If you do not agree to these Terms,
                please do not use our services.
              </p>
            </div>

            <div className="space-y-8">
              <div>
                <h2 className="text-2xl font-bold text-gray-900 mb-4">1. Acceptance of Terms</h2>
                <p className="text-gray-700 leading-relaxed">
                  By accessing or using the Denel Dental Clinic website, booking appointments, or
                  receiving dental services, you acknowledge that you have read, understood, and
                  agree to be bound by these Terms of Service and our Privacy Policy. These Terms
                  apply to all visitors, users, and patients.
                </p>
              </div>

              <div>
                <h2 className="text-2xl font-bold text-gray-900 mb-4">2. Services Provided</h2>
                <p className="text-gray-700 leading-relaxed mb-4">
                  Denel Dental Clinic provides comprehensive dental care services including:
                </p>
                <ul className="list-disc pl-6 space-y-2 text-gray-700">
                  <li>Dental consultations and examinations</li>
                  <li>Preventive and restorative dental treatments</li>
                  <li>Cosmetic dentistry services</li>
                  <li>Orthodontic services (braces and clear aligners)</li>
                  <li>Dental laboratory services</li>
                  <li>Digital dental xrays and imaging</li>
                  <li>Emergency dental care</li>
                </ul>
                <p className="text-gray-700 leading-relaxed mt-4">
                  All services are provided by licensed dental professionals in accordance with
                  applicable laws and regulations in Ghana.
                </p>
              </div>

              <div>
                <h2 className="text-2xl font-bold text-gray-900 mb-4">
                  3. Appointment Booking and Cancellation
                </h2>
                <p className="text-gray-700 leading-relaxed mb-4">
                  When booking appointments through our website or other channels:
                </p>
                <ul className="list-disc pl-6 space-y-2 text-gray-700">
                  <li>You agree to provide accurate and complete information</li>
                  <li>Appointments are subject to availability and confirmation by our clinic</li>
                  <li>
                    We require at least 24 hours notice for appointment cancellations or
                    rescheduling
                  </li>
                  <li>
                    Repeated no-shows or late cancellations may result in restrictions on future
                    bookings
                  </li>
                  <li>
                    We reserve the right to reschedule or cancel appointments due to emergencies or
                    unforeseen circumstances
                  </li>
                </ul>
              </div>

              <div>
                <h2 className="text-2xl font-bold text-gray-900 mb-4">4. Payment Terms</h2>
                <p className="text-gray-700 leading-relaxed mb-4">Payment terms and policies:</p>
                <ul className="list-disc pl-6 space-y-2 text-gray-700">
                  <li>
                    Payment is due at the time of service unless other arrangements have been made
                    in advance
                  </li>
                  <li>
                    We accept cash, credit cards, debit cards, and most major dental insurance plans
                  </li>
                  <li>
                    For extensive treatments, payment plans may be available upon request and
                    approval
                  </li>
                  <li>All fees are quoted in Ghana Cedis (GHS) unless otherwise stated</li>
                  <li>
                    Prices are subject to change without notice, but confirmed appointments will be
                    honored at the quoted price
                  </li>
                  <li>
                    Refunds are subject to our refund policy and may not be available for completed
                    services
                  </li>
                </ul>
              </div>

              <div>
                <h2 className="text-2xl font-bold text-gray-900 mb-4">
                  5. Medical Information and Consent
                </h2>
                <p className="text-gray-700 leading-relaxed mb-4">
                  By receiving dental services, you acknowledge and agree that:
                </p>
                <ul className="list-disc pl-6 space-y-2 text-gray-700">
                  <li>You have provided accurate medical and dental history information</li>
                  <li>
                    You understand the nature of proposed treatments and have had the opportunity to
                    ask questions
                  </li>
                  <li>
                    You consent to necessary dental procedures as recommended by our dental
                    professionals
                  </li>
                  <li>
                    You understand that dental treatment outcomes may vary and cannot be guaranteed
                  </li>
                  <li>You will follow post-treatment care instructions provided by our team</li>
                </ul>
              </div>

              <div>
                <h2 className="text-2xl font-bold text-gray-900 mb-4">
                  6. Website Use and Intellectual Property
                </h2>
                <p className="text-gray-700 leading-relaxed mb-4">Regarding use of our website:</p>
                <ul className="list-disc pl-6 space-y-2 text-gray-700">
                  <li>
                    All content on this website, including text, images, logos, and design, is the
                    property of Denel Dental Clinic and protected by copyright laws
                  </li>
                  <li>
                    You may not reproduce, distribute, or use our content without written permission
                  </li>
                  <li>
                    You agree not to use the website for any unlawful purpose or in any way that
                    could damage or impair the website
                  </li>
                  <li>
                    We reserve the right to modify or discontinue the website at any time without
                    notice
                  </li>
                </ul>
              </div>

              <div>
                <h2 className="text-2xl font-bold text-gray-900 mb-4">
                  7. Limitation of Liability
                </h2>
                <p className="text-gray-700 leading-relaxed">
                  To the maximum extent permitted by law, Denel Dental Clinic shall not be liable
                  for any indirect, incidental, special, consequential, or punitive damages, or any
                  loss of profits or revenues, whether incurred directly or indirectly, or any loss
                  of data, use, goodwill, or other intangible losses resulting from your use of our
                  services or website.
                </p>
              </div>

              <div>
                <h2 className="text-2xl font-bold text-gray-900 mb-4">8. Indemnification</h2>
                <p className="text-gray-700 leading-relaxed">
                  You agree to indemnify and hold harmless Denel Dental Clinic, its employees, and
                  agents from any claims, damages, losses, liabilities, and expenses (including
                  legal fees) arising out of or relating to your use of our services, violation of
                  these Terms, or infringement of any rights of another party.
                </p>
              </div>

              <div>
                <h2 className="text-2xl font-bold text-gray-900 mb-4">
                  9. Privacy and Confidentiality
                </h2>
                <p className="text-gray-700 leading-relaxed">
                  We are committed to maintaining the confidentiality of your personal and medical
                  information in accordance with our Privacy Policy and applicable healthcare
                  privacy laws. All patient information is handled with the utmost care and
                  security.
                </p>
              </div>

              <div>
                <h2 className="text-2xl font-bold text-gray-900 mb-4">10. Dispute Resolution</h2>
                <p className="text-gray-700 leading-relaxed mb-4">
                  Any disputes arising from these Terms or our services shall be resolved through:
                </p>
                <ul className="list-disc pl-6 space-y-2 text-gray-700">
                  <li>Good faith negotiation between the parties</li>
                  <li>Mediation, if negotiation is unsuccessful</li>
                  <li>Legal proceedings in the courts of Ghana, if mediation fails</li>
                </ul>
              </div>

              <div>
                <h2 className="text-2xl font-bold text-gray-900 mb-4">
                  11. Modifications to Terms
                </h2>
                <p className="text-gray-700 leading-relaxed">
                  We reserve the right to modify these Terms at any time. Material changes will be
                  posted on our website with an updated "Last Updated" date. Your continued use of
                  our services after such modifications constitutes acceptance of the updated Terms.
                </p>
              </div>

              <div>
                <h2 className="text-2xl font-bold text-gray-900 mb-4">12. Governing Law</h2>
                <p className="text-gray-700 leading-relaxed">
                  These Terms shall be governed by and construed in accordance with the laws of
                  Ghana. Any legal action or proceeding arising under these Terms will be brought
                  exclusively in the courts of Ghana.
                </p>
              </div>

              <div>
                <h2 className="text-2xl font-bold text-gray-900 mb-4">13. Severability</h2>
                <p className="text-gray-700 leading-relaxed">
                  If any provision of these Terms is found to be invalid or unenforceable, the
                  remaining provisions shall continue in full force and effect.
                </p>
              </div>

              <div>
                <h2 className="text-2xl font-bold text-gray-900 mb-4">14. Contact Information</h2>
                <p className="text-gray-700 leading-relaxed mb-4">
                  If you have any questions about these Terms of Service, please contact us:
                </p>
                <div className="bg-gray-50 p-6 rounded-lg">
                  <p className="text-gray-700 mb-2">
                    <strong>Denel Dental Clinic</strong>
                  </p>
                  <p className="text-gray-700 mb-2">Address to be confirmed</p>
                  <p className="text-gray-700 mb-2">Phone: +233 XX XXX XXXX</p>
                  <p className="text-gray-700">Email: info@deneldental.com</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
      <Footer />
    </div>
  )
}
