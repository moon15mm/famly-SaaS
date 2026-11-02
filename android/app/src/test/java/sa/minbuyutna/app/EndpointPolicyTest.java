package sa.minbuyutna.app;

import org.junit.Test;
import static org.junit.Assert.*;

public class EndpointPolicyTest {
    @Test public void canonicalOrigin() {
        assertEquals("https://example.test", EndpointPolicy.normalize(" HTTPS://EXAMPLE.TEST:443/ ", false));
        assertEquals("http://localhost:3000", EndpointPolicy.normalize("http://localhost:3000", true));
    }
    @Test public void rejectAmbiguousOrUnsafeEndpoints() {
        for (String value : new String[]{"http://example.test", "https://user:secret@example.test", // pragma: allowlist secret
                "https://example.test/path", "https://example.test?token=a", "https://example.test#x",
                "file:///data/private", "javascript:alert(1)", "http://localhost.evil.test:3000",
                "http://192.168.1.2:3000", "https://example.test:65536", "https://example.test:0"}) {
            assertThrows(value, IllegalArgumentException.class, () -> EndpointPolicy.normalize(value, true));
        }
        assertThrows(IllegalArgumentException.class, () -> EndpointPolicy.normalize("http://localhost:3000", false));
    }
    @Test public void sameOriginIncludesSchemeHostAndPort() {
        assertTrue(EndpointPolicy.sameOrigin("https://example.test", "https://EXAMPLE.TEST:443/account"));
        assertTrue(EndpointPolicy.sameOrigin("http://localhost:3000", "http://localhost:3000/api/docs?x=1"));
        for (String value : new String[]{"https://example.test.evil.test", "http://example.test",
                "https://example.test:444", "https://user@example.test", "blob:https://example.test/a",
                "content://example.test/a", "javascript:alert(1)"}) {
            assertFalse(value, EndpointPolicy.sameOrigin("https://example.test", value));
        }
    }
    @Test public void noIntentOrLocalFileExternalNavigation() {
        assertTrue(EndpointPolicy.externalAllowed("https://maps.example.test/"));
        assertTrue(EndpointPolicy.externalAllowed("geo:24.71,46.61"));
        assertFalse(EndpointPolicy.externalAllowed("intent://anything"));
        assertFalse(EndpointPolicy.externalAllowed("file:///data/private"));
        assertFalse(EndpointPolicy.externalAllowed("javascript:alert(1)"));
    }
}
