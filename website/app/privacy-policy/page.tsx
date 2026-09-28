'use client'

import Footer from '@/components/footer'
import NavigationMenuDemo from '@/components/navigation-menu'
import PageHeader from '@/components/page-header'

export default function PrivacyPolicyPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <NavigationMenuDemo />
      <PageHeader
        title="Privacy Policy"
        description="Your privacy is important to us. Learn how we collect, use, and protect your personal information."
        backgroundImage="/bg02.jpg"
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
                At Denel Dental Clinic, we are committed to protecting your privacy and ensuring the
                security of your personal information. This Privacy Policy explains how we collect,
                use, disclose, and safeguard your information when you visit our website or use our
                services.
              </p>
            </div>

            <div className="space-y-8">
              <div>
                <h2 className="text-2xl font-bold text-gray-900 mb-4">1. Information We Collect</h2>
                <p className="text-gray-700 leading-relaxed mb-4">
                  We collect information that you provide directly to us, including:
                </p>
                <ul className="list-disc pl-6 space-y-2 text-gray-700">
                  <li>
                    <strong>Personal Information:</strong> Name, email address, phone number, and
                    other contact details when you book an appointment or contact us through our
                    website.
                  </li>
                  <li>
                    <strong>Health Information:</strong> Information about your dental health,
                    treatment preferences, and medical history that you provide when scheduling
                    appointments or during consultations.
                  </li>
                  <li>
                    <strong>Appointment Information:</strong> Preferred dates, times, services
                    requested, and any additional messages or notes you provide.
                  </li>
                  <li>
                    <strong>Website Usage Data:</strong> Information about how you interact with our
                    website, including IP address, browser type, and pages visited.
                  </li>
                </ul>
              </div>

              <div>
                <h2 className="text-2xl font-bold text-gray-900 mb-4">
                  2. How We Use Your Information
                </h2>
                <p className="text-gray-700 leading-relaxed mb-4">
                  We use the information we collect to:
                </p>
                <ul className="list-disc pl-6 space-y-2 text-gray-700">
                  <li>Schedule and manage your dental appointments</li>
                  <li>Provide dental care services and treatment</li>
                  <li>
                    Communicate with you about your appointments, treatments, and follow-up care
                  </li>
                  <li>Respond to your inquiries and provide customer support</li>
                  <li>Send you important updates about our services (with your consent)</li>
                  <li>Improve our website and services</li>
                  <li>Comply with legal obligations and regulatory requirements</li>
                </ul>
              </div>

              <div>
                <h2 className="text-2xl font-bold text-gray-900 mb-4">
                  3. Information Sharing and Disclosure
                </h2>
                <p className="text-gray-700 leading-relaxed mb-4">
                  We do not sell, trade, or rent your personal information to third parties. We may
                  share your information only in the following circumstances:
                </p>
                <ul className="list-disc pl-6 space-y-2 text-gray-700">
                  <li>
                    <strong>Service Providers:</strong> We may share information with trusted
                    third-party service providers who assist us in operating our website and
                    providing dental services, such as appointment scheduling systems and data
                    storage services.
                  </li>
                  <li>
                    <strong>Legal Requirements:</strong> We may disclose information when required
                    by law, court order, or government regulation, or to protect our rights and the
                    safety of our patients.
                  </li>
                  <li>
                    <strong>Medical Professionals:</strong> We may share relevant health information
                    with other healthcare providers involved in your treatment, with your consent.
                  </li>
                  <li>
                    <strong>Business Transfers:</strong> In the event of a merger, acquisition, or
                    sale of assets, your information may be transferred as part of that transaction.
                  </li>
                </ul>
              </div>

              <div>
                <h2 className="text-2xl font-bold text-gray-900 mb-4">4. Data Security</h2>
                <p className="text-gray-700 leading-relaxed">
                  We implement appropriate technical and organizational security measures to protect
                  your personal information against unauthorized access, alteration, disclosure, or
                  destruction. However, no method of transmission over the internet or electronic
                  storage is 100% secure, and we cannot guarantee absolute security.
                </p>
              </div>

              <div>
                <h2 className="text-2xl font-bold text-gray-900 mb-4">5. Your Rights</h2>
                <p className="text-gray-700 leading-relaxed mb-4">You have the right to:</p>
                <ul className="list-disc pl-6 space-y-2 text-gray-700">
                  <li>Access and review your personal information</li>
                  <li>Request corrections to inaccurate or incomplete information</li>
                  <li>
                    Request deletion of your personal information (subject to legal and medical
                    record retention requirements)
                  </li>
                  <li>Object to or restrict certain processing of your information</li>
                  <li>Withdraw consent for marketing communications at any time</li>
                </ul>
                <p className="text-gray-700 leading-relaxed mt-4">
                  To exercise these rights, please contact us using the information provided in the
                  "Contact Us" section below.
                </p>
              </div>

              <div>
                <h2 className="text-2xl font-bold text-gray-900 mb-4">6. Medical Records</h2>
                <p className="text-gray-700 leading-relaxed">
                  As a healthcare provider, we are required to maintain medical records in
                  accordance with applicable laws and regulations in Ghana. Medical records are
                  retained for the period required by law and may not be deleted even upon request,
                  as they are essential for continuity of care and legal compliance.
                </p>
              </div>

              <div>
                <h2 className="text-2xl font-bold text-gray-900 mb-4">
                  7. Cookies and Tracking Technologies
                </h2>
                <p className="text-gray-700 leading-relaxed">
                  Our website may use cookies and similar tracking technologies to enhance your
                  browsing experience and analyze website traffic. You can control cookie
                  preferences through your browser settings, though this may affect website
                  functionality.
                </p>
              </div>

              <div>
                <h2 className="text-2xl font-bold text-gray-900 mb-4">8. Third-Party Links</h2>
                <p className="text-gray-700 leading-relaxed">
                  Our website may contain links to third-party websites. We are not responsible for
                  the privacy practices or content of these external sites. We encourage you to
                  review the privacy policies of any third-party sites you visit.
                </p>
              </div>

              <div>
                <h2 className="text-2xl font-bold text-gray-900 mb-4">9. Children's Privacy</h2>
                <p className="text-gray-700 leading-relaxed">
                  Our services are available to patients of all ages, including children. For
                  patients under 18, we require parental or guardian consent for treatment and
                  information collection.
                </p>
              </div>

              <div>
                <h2 className="text-2xl font-bold text-gray-900 mb-4">
                  10. Changes to This Privacy Policy
                </h2>
                <p className="text-gray-700 leading-relaxed">
                  We may update this Privacy Policy from time to time to reflect changes in our
                  practices or legal requirements. We will notify you of any material changes by
                  posting the updated policy on our website and updating the "Last Updated" date.
                </p>
              </div>

              <div>
                <h2 className="text-2xl font-bold text-gray-900 mb-4">11. Contact Us</h2>
                <p className="text-gray-700 leading-relaxed mb-4">
                  If you have any questions, concerns, or requests regarding this Privacy Policy or
                  our data practices, please contact us:
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
