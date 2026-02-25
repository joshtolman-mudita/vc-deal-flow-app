import NextAuth from "next-auth";

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    {
      id: "hubspot",
      name: "HubSpot",
      type: "oauth",
      authorization: {
        url: "https://app.hubspot.com/oauth/authorize",
        params: {
          scope: "oauth crm.objects.deals.read crm.objects.companies.read crm.schemas.deals.read content",
        },
      },
      token: "https://api.hubapi.com/oauth/v1/token",
      userinfo: "https://api.hubapi.com/oauth/v1/access-tokens/",
      clientId: process.env.HUBSPOT_CLIENT_ID,
      clientSecret: process.env.HUBSPOT_CLIENT_SECRET,
      profile(profile: any, tokens: any) {
        return {
          id: profile.user_id || profile.hub_id,
          name: profile.user || "HubSpot User",
          email: profile.user,
          image: null,
          hubId: profile.hub_id,
          accessToken: tokens.access_token,
        };
      },
    },
  ],
  callbacks: {
    async jwt({ token, account, profile }) {
      // Persist the OAuth access_token to the token right after signin
      if (account) {
        token.accessToken = account.access_token;
        token.hubId = (profile as any)?.hub_id;
      }
      return token;
    },
    async session({ session, token }) {
      // Send properties to the client
      (session as any).accessToken = token.accessToken;
      (session as any).hubId = token.hubId;
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
  secret: process.env.NEXTAUTH_SECRET,
});

