import { MongoClient } from "mongodb";

async function main() {
    const uri = "mongodb://localhost:27017/wellness_db";
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 3000 });
    try {
        await client.connect();
        const db = client.db("wellness_db");
        const collections = await db.listCollections().toArray();
        console.log("✅ MongoDB IS connected! Collections:", collections.map(c => c.name));
        for (const col of collections) {
            const count = await db.collection(col.name).countDocuments();
            console.log(`   ${col.name}: ${count} documents`);
        }

        // Show sample data from each collection
        for (const col of collections) {
            const sample = await db.collection(col.name).findOne();
            if (sample) {
                console.log(`\n--- Sample from ${col.name} ---`);
                console.log(JSON.stringify(sample, null, 2).slice(0, 500));
            }
        }

        await client.close();
    } catch (err: any) {
        console.log("❌ MongoDB NOT reachable:", err.message);
    }
}

main();
